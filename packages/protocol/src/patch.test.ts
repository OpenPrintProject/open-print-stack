import { describe, expect, it } from "vitest";
import { idleState, printingState } from "./fixtures.ts";
import { applyStatePatch, diffState, isEmptyPatch } from "./patch.ts";
import { type PrinterState, statePatchSchema } from "./state.ts";

describe("diffState", () => {
	it("is empty when nothing changed", () => {
		expect(isEmptyPatch(diffState(idleState, structuredClone(idleState)))).toBe(
			true,
		);
	});

	it("contains only the nested fields that changed", () => {
		const next: PrinterState = structuredClone(printingState);
		if (!next.job?.layer) throw new Error("fixture needs a job");
		next.job.progress = 0.3;
		next.job.layer.current = 36;

		expect(diffState(printingState, next)).toEqual({
			job: { progress: 0.3, layer: { current: 36 } },
		});
	});

	it("sends arrays whole", () => {
		const next = structuredClone(printingState);
		next.temps.tools = [{ current: 221, target: 220 }];

		expect(diffState(printingState, next)).toEqual({
			temps: { tools: [{ current: 221, target: 220 }] },
		});
	});

	it("sends a new job whole and a finished job as null", () => {
		const started = diffState(idleState, printingState);
		expect(started.job).toEqual(printingState.job);

		const finished = diffState(printingState, idleState);
		expect(finished.job).toBeNull();
	});

	it("produces patches that pass the patch schema", () => {
		const patch = diffState(idleState, printingState);
		expect(statePatchSchema.parse(patch)).toEqual(patch);
	});

	it("doesn't share objects with the input", () => {
		const next = structuredClone(printingState);
		const patch = diffState(idleState, next);
		if (!next.job) throw new Error("fixture needs a job");
		next.job.fileName = "changed.gcode";

		expect(patch.job?.fileName).toBe("benchy.gcode");
	});
});

describe("applyStatePatch", () => {
	it("round-trips with diffState in both directions", () => {
		expect(
			applyStatePatch(idleState, diffState(idleState, printingState)),
		).toEqual(printingState);
		expect(
			applyStatePatch(printingState, diffState(printingState, idleState)),
		).toEqual(idleState);
	});

	it("sets null rather than deleting", () => {
		const next = applyStatePatch(printingState, { temps: { bed: null } });
		expect(next.temps.bed).toBeNull();
		expect(next.temps.tools).toEqual(printingState.temps.tools);
	});

	it("leaves the original state untouched", () => {
		const before = structuredClone(printingState);
		applyStatePatch(printingState, { job: { progress: 0.9 } });
		expect(printingState).toEqual(before);
	});

	it("throws when the result isn't a valid state", () => {
		// A partial job can't be applied when there's no job to merge into.
		expect(() =>
			applyStatePatch(idleState, { job: { progress: 0.5 } }),
		).toThrow();
	});
});
