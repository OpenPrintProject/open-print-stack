import { z } from "zod";

/** Protocol version spoken by this build. The cloud also accepts the previous version. */
export const PROTOCOL_VERSION = 1;

/** Every message between the agent and the cloud uses this envelope. See docs/architecture.md. */
export const messageSchema = z.object({
	v: z.number().int().positive(),
	id: z.string().min(1),
	type: z.string().min(1),
	printerId: z.string().min(1).optional(),
	ts: z.number().int().nonnegative(),
	payload: z.unknown(),
});

export type Message = z.infer<typeof messageSchema>;

export function parseMessage(raw: string): Message {
	return messageSchema.parse(JSON.parse(raw));
}
