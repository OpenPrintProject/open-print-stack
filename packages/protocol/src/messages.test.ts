import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "./envelope.ts";
import { capabilities, idleState } from "./fixtures.ts";
import {
	createMessage,
	isCommandMessage,
	parseAgentMessage,
	parseCloudMessage,
	toPrinterCommand,
} from "./messages.ts";

const wire = (message: unknown) => JSON.stringify(message);

describe("createMessage", () => {
	it("fills in the version, a unique id and a timestamp", () => {
		const a = createMessage("event.ack", { replyTo: "msg_1", payload: {} });
		const b = createMessage("event.ack", { replyTo: "msg_1", payload: {} });

		expect(a.v).toBe(PROTOCOL_VERSION);
		expect(a.id).not.toBe(b.id);
		expect(a.ts).toBeGreaterThan(0);
	});
});

describe("agent → cloud messages", () => {
	it("parses a hello", () => {
		const hello = createMessage("hello", {
			payload: {
				agentId: "agt_1",
				secret: "s3cret",
				agentVersion: "0.1.0",
				protocolVersions: [1],
				platform: { os: "linux", arch: "arm64" },
			},
		});
		expect(parseAgentMessage(wire(hello))).toEqual(hello);
	});

	it("parses a state snapshot and patch", () => {
		const snapshot = createMessage("state.snapshot", {
			printerId: "prt_1",
			payload: { state: idleState, capabilities },
		});
		const patch = createMessage("state.patch", {
			printerId: "prt_1",
			payload: { temps: { bed: { target: 60 } } },
		});

		expect(parseAgentMessage(wire(snapshot))).toEqual(snapshot);
		expect(parseAgentMessage(wire(patch))).toEqual(patch);
	});

	it("parses an event", () => {
		const event = createMessage("event", {
			printerId: "prt_1",
			payload: { kind: "filament.runout", unit: 0, slot: 2 },
		});
		expect(parseAgentMessage(wire(event))).toEqual(event);
	});

	it("parses successful and failed command results", () => {
		const ok = createMessage("cmd.result", {
			printerId: "prt_1",
			replyTo: "msg_1",
			payload: { ok: true },
		});
		const failed = createMessage("cmd.result", {
			printerId: "prt_1",
			replyTo: "msg_2",
			payload: {
				ok: false,
				error: { code: "printer_offline", message: "Printer is offline" },
			},
		});

		expect(parseAgentMessage(wire(ok))).toEqual(ok);
		expect(parseAgentMessage(wire(failed))).toEqual(failed);
	});

	it("rejects printer messages without a printerId", () => {
		const raw = wire({
			v: 1,
			id: "msg_1",
			ts: 1,
			type: "state.patch",
			payload: {},
		});
		expect(() => parseAgentMessage(raw)).toThrow();
	});

	it("rejects a command result without replyTo", () => {
		const raw = wire({
			v: 1,
			id: "msg_1",
			ts: 1,
			type: "cmd.result",
			printerId: "prt_1",
			payload: { ok: true },
		});
		expect(() => parseAgentMessage(raw)).toThrow();
	});

	it("rejects an unknown error code", () => {
		const raw = wire({
			v: 1,
			id: "msg_1",
			ts: 1,
			type: "cmd.result",
			printerId: "prt_1",
			replyTo: "msg_0",
			payload: { ok: false, error: { code: "oops", message: "" } },
		});
		expect(() => parseAgentMessage(raw)).toThrow();
	});

	it("rejects messages only the cloud sends", () => {
		const ack = createMessage("event.ack", { replyTo: "msg_1", payload: {} });
		expect(() => parseAgentMessage(wire(ack))).toThrow();
	});
});

describe("cloud → agent messages", () => {
	it("parses hello replies", () => {
		const ok = createMessage("hello.ok", {
			replyTo: "msg_1",
			payload: { protocolVersion: 1, serverTime: 1_759_312_800_000 },
		});
		const error = createMessage("hello.error", {
			replyTo: "msg_1",
			payload: { code: "revoked", message: "This agent was removed" },
		});

		expect(parseCloudMessage(wire(ok))).toEqual(ok);
		expect(parseCloudMessage(wire(error))).toEqual(error);
	});

	it("parses commands and turns them into driver commands", () => {
		const start = createMessage("cmd.print.start", {
			printerId: "prt_1",
			payload: { fileName: "benchy.gcode" },
		});
		const parsed = parseCloudMessage(wire(start));

		expect(isCommandMessage(parsed)).toBe(true);
		if (!isCommandMessage(parsed)) return;
		expect(toPrinterCommand(parsed)).toEqual({
			name: "print.start",
			params: { fileName: "benchy.gcode" },
		});
	});

	it("rejects a start command without a file name", () => {
		const raw = wire({
			v: 1,
			id: "msg_1",
			ts: 1,
			type: "cmd.print.start",
			printerId: "prt_1",
			payload: {},
		});
		expect(() => parseCloudMessage(raw)).toThrow();
	});

	it("rejects unknown commands", () => {
		const raw = wire({
			v: 1,
			id: "msg_1",
			ts: 1,
			type: "cmd.firmware.flash",
			printerId: "prt_1",
			payload: {},
		});
		expect(() => parseCloudMessage(raw)).toThrow();
	});

	it("doesn't treat other messages as commands", () => {
		const ack = parseCloudMessage(
			wire(createMessage("event.ack", { replyTo: "msg_1", payload: {} })),
		);
		expect(isCommandMessage(ack)).toBe(false);
	});
});
