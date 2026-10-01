import { describe, expect, it } from "vitest";
import { capabilities, idleState, printingState } from "./fixtures.ts";
import {
	printerCapabilitiesSchema,
	printerStateSchema,
	statePatchSchema,
} from "./state.ts";

describe("printerStateSchema", () => {
	it("accepts idle and printing states", () => {
		expect(printerStateSchema.parse(idleState)).toEqual(idleState);
		expect(printerStateSchema.parse(printingState)).toEqual(printingState);
	});

	it("rejects progress outside 0–1", () => {
		const job = printingState.job && { ...printingState.job, progress: 25 };
		expect(() => printerStateSchema.parse({ ...printingState, job })).toThrow();
	});

	it("rejects fan speeds outside 0–1", () => {
		const fans = { part: 255, aux: null, chamber: null };
		expect(() => printerStateSchema.parse({ ...idleState, fans })).toThrow();
	});

	it("rejects fractional layer numbers", () => {
		const job = printingState.job && {
			...printingState.job,
			layer: { current: 1.5, total: 120 },
		};
		expect(() => printerStateSchema.parse({ ...printingState, job })).toThrow();
	});

	it("rejects an unknown status", () => {
		expect(() =>
			printerStateSchema.parse({ ...idleState, status: "sleeping" }),
		).toThrow();
	});

	it("needs every field, so unknown values must be sent as null", () => {
		const { flowFactor: _, ...withoutFlow } = idleState;
		expect(() => printerStateSchema.parse(withoutFlow)).toThrow();
	});
});

describe("statePatchSchema", () => {
	it("accepts nested partial changes", () => {
		const patch = {
			job: { progress: 0.5, layer: { current: 60 } },
			temps: { bed: { current: 59.5 } },
		};
		expect(statePatchSchema.parse(patch)).toEqual(patch);
	});

	it("still checks units", () => {
		expect(() => statePatchSchema.parse({ job: { progress: 2 } })).toThrow();
	});
});

describe("printerCapabilitiesSchema", () => {
	it("accepts capabilities with and without a chamber limit", () => {
		expect(printerCapabilitiesSchema.parse(capabilities)).toEqual(capabilities);
		const withChamber = {
			...capabilities,
			maxTemps: { ...capabilities.maxTemps, chamber: 60 },
		};
		expect(printerCapabilitiesSchema.parse(withChamber)).toEqual(withChamber);
	});
});
