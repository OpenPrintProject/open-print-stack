import { z } from "zod";
import {
	type CommandName,
	commandParamsSchemas,
	commandResultSchema,
	type PrinterCommand,
} from "./commands.ts";
import { messageSchema, PROTOCOL_VERSION } from "./envelope.ts";
import { printerEventSchema } from "./events.ts";
import {
	printerCapabilitiesSchema,
	printerStateSchema,
	statePatchSchema,
} from "./state.ts";

const id = z.string().min(1);
const base = messageSchema.pick({ v: true, id: true, ts: true });

function agentMessage<T extends string, P extends z.ZodType>(
	type: T,
	payload: P,
) {
	return base.extend({ type: z.literal(type), payload });
}

function printerMessage<T extends string, P extends z.ZodType>(
	type: T,
	payload: P,
) {
	return base.extend({ type: z.literal(type), printerId: id, payload });
}

function replyMessage<T extends string, P extends z.ZodType>(
	type: T,
	payload: P,
) {
	return base.extend({ type: z.literal(type), replyTo: id, payload });
}

function commandMessage<N extends CommandName>(name: N) {
	return printerMessage(`cmd.${name}` as const, commandParamsSchemas[name]);
}

// Agent → cloud

/** The agent's first message on every connection. */
export const helloMessageSchema = agentMessage(
	"hello",
	z.object({
		agentId: id,
		secret: z.string().min(1),
		agentVersion: z.string().min(1),
		/** Every protocol version this agent can speak. The cloud picks one. */
		protocolVersions: z.array(z.int().positive()).min(1),
		platform: z.object({ os: z.string(), arch: z.string() }),
	}),
);

/** Sent on connect and reconnect for each printer: everything the cloud needs to know about it. */
export const stateSnapshotMessageSchema = printerMessage(
	"state.snapshot",
	z.object({
		state: printerStateSchema,
		capabilities: printerCapabilitiesSchema,
	}),
);

/** Only what changed since the last snapshot or patch. Not acknowledged. */
export const statePatchMessageSchema = printerMessage(
	"state.patch",
	statePatchSchema,
);

/** Acknowledged by `event.ack`. Saved to disk while offline; the cloud ignores repeats by message `id`. */
export const eventMessageSchema = printerMessage("event", printerEventSchema);

export const commandResultMessageSchema = printerMessage(
	"cmd.result",
	commandResultSchema,
).extend({ replyTo: id });

export const agentMessageSchema = z.discriminatedUnion("type", [
	helloMessageSchema,
	stateSnapshotMessageSchema,
	statePatchMessageSchema,
	eventMessageSchema,
	commandResultMessageSchema,
]);

export type AgentMessage = z.infer<typeof agentMessageSchema>;

// Cloud → agent

export const helloOkMessageSchema = replyMessage(
	"hello.ok",
	z.object({
		protocolVersion: z.int().positive(),
		serverTime: z.int().nonnegative(),
	}),
);

export const helloErrorMessageSchema = replyMessage(
	"hello.error",
	z.object({
		code: z.enum(["unauthorized", "revoked", "unsupported_version"]),
		message: z.string(),
	}),
);

export const eventAckMessageSchema = replyMessage("event.ack", z.object({}));

export const commandMessageSchema = z.discriminatedUnion("type", [
	commandMessage("print.start"),
	commandMessage("print.pause"),
	commandMessage("print.resume"),
	commandMessage("print.cancel"),
]);

export type CommandMessage = z.infer<typeof commandMessageSchema>;

export const cloudMessageSchema = z.discriminatedUnion("type", [
	helloOkMessageSchema,
	helloErrorMessageSchema,
	eventAckMessageSchema,
	...commandMessageSchema.options,
]);

export type CloudMessage = z.infer<typeof cloudMessageSchema>;

// Helpers

export type MessageType = AgentMessage["type"] | CloudMessage["type"];

export type MessageOf<T extends MessageType> = Extract<
	AgentMessage | CloudMessage,
	{ type: T }
>;

/** Builds a message, filling in the protocol version, a fresh id and the timestamp. */
export function createMessage<T extends MessageType>(
	type: T,
	fields: Omit<MessageOf<T>, "v" | "id" | "ts" | "type">,
): MessageOf<T> {
	return {
		v: PROTOCOL_VERSION,
		id: crypto.randomUUID(),
		ts: Date.now(),
		type,
		...fields,
	} as MessageOf<T>;
}

/** Parses and validates a message the cloud received from an agent. Throws if it's invalid. */
export function parseAgentMessage(raw: string): AgentMessage {
	return agentMessageSchema.parse(JSON.parse(raw));
}

/** Parses and validates a message the agent received from the cloud. Throws if it's invalid. */
export function parseCloudMessage(raw: string): CloudMessage {
	return cloudMessageSchema.parse(JSON.parse(raw));
}

export function isCommandMessage(
	message: CloudMessage,
): message is CommandMessage {
	return message.type.startsWith("cmd.");
}

/** The command a driver should run for a command message. */
export function toPrinterCommand(message: CommandMessage): PrinterCommand {
	return {
		name: message.type.slice("cmd.".length),
		params: message.payload,
	} as PrinterCommand;
}
