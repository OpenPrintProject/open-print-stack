import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, parseMessage } from "./envelope.ts";

describe("parseMessage", () => {
	it("accepts a valid envelope", () => {
		const raw = JSON.stringify({
			v: PROTOCOL_VERSION,
			id: "msg_1",
			type: "state.patch",
			printerId: "prt_1",
			ts: 1_759_312_800_000,
			payload: { status: "idle" },
		});

		expect(parseMessage(raw)).toMatchObject({
			type: "state.patch",
			printerId: "prt_1",
		});
	});

	it("rejects an envelope without a type", () => {
		const raw = JSON.stringify({ v: 1, id: "msg_1", ts: 0, payload: null });

		expect(() => parseMessage(raw)).toThrow();
	});
});
