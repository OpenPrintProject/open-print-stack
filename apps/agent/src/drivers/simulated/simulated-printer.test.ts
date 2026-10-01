import { describe, expect, it } from "bun:test";
import {
	type CommandErrorCode,
	type PrinterEvent,
	type PrinterState,
	type PrinterStatus,
	printerCapabilitiesSchema,
	printerStateSchema,
} from "@ops/protocol";
import { CommandError } from "../driver.ts";
import {
	SimulatedPrinter,
	type SimulatedPrinterOptions,
} from "./simulated-printer.ts";

const PRINT_SEC = 100;

async function connected(options: SimulatedPrinterOptions = {}) {
	const printer = new SimulatedPrinter({
		autoAdvance: false,
		printDurationSec: PRINT_SEC,
		layerCount: 50,
		...options,
	});
	const states: PrinterState[] = [];
	const events: PrinterEvent[] = [];
	printer.onStateChange((state) => states.push(state));
	printer.onEvent((event) => events.push(event));
	await printer.connect();
	return { printer, states, events };
}

/** Advances a second at a time until the printer reaches `status`. */
function advanceUntil(
	printer: SimulatedPrinter,
	status: PrinterStatus,
	maxSec = 600,
): void {
	for (let sec = 0; sec < maxSec; sec++) {
		if (printer.getState().status === status) return;
		printer.advance(1000);
	}
	throw new Error(
		`Never reached ${status}; stuck at ${printer.getState().status}`,
	);
}

async function printing(options: SimulatedPrinterOptions = {}) {
	const sim = await connected(options);
	await sim.printer.execute({
		name: "print.start",
		params: { fileName: "benchy.gcode" },
	});
	advanceUntil(sim.printer, "printing");
	return sim;
}

async function expectCommandError(
	promise: Promise<unknown>,
	code: CommandErrorCode,
) {
	const error = await promise.catch((e: unknown) => e);
	expect(error).toBeInstanceOf(CommandError);
	expect((error as CommandError).code).toBe(code);
}

describe("SimulatedPrinter", () => {
	it("is offline until connected, then idle at room temperature", async () => {
		const printer = new SimulatedPrinter({ autoAdvance: false });
		expect(printer.getState().status).toBe("offline");

		await printer.connect();
		const state = printer.getState();
		expect(state.status).toBe("idle");
		expect(state.job).toBeNull();
		expect(state.temps.tools).toEqual([{ current: 22, target: 0 }]);
		expect(state.filamentUnits[0]?.slots).toHaveLength(4);
	});

	it("reports valid capabilities, with overrides", () => {
		const printer = new SimulatedPrinter({
			autoAdvance: false,
			capabilities: { hasCamera: false },
		});
		const capabilities = printer.getCapabilities();
		expect(printerCapabilitiesSchema.parse(capabilities)).toEqual(capabilities);
		expect(capabilities.hasCamera).toBe(false);
		expect(capabilities.canSkipObjects).toBe(false);
	});

	it("runs a whole print: heat, print, finish, cool", async () => {
		const { printer, states } = await connected();
		await printer.execute({
			name: "print.start",
			params: { fileName: "benchy.gcode" },
		});

		let state = printer.getState();
		expect(state.status).toBe("preparing");
		expect(state.job).toMatchObject({ fileName: "benchy.gcode", progress: 0 });
		expect(state.temps.tools[0]?.target).toBe(220);
		expect(state.temps.bed?.target).toBe(60);

		advanceUntil(printer, "printing");
		state = printer.getState();
		expect(state.temps.tools[0]?.current).toBe(220);
		expect(state.temps.bed?.current).toBe(60);

		printer.advance(PRINT_SEC * 500);
		state = printer.getState();
		expect(state.job?.progress).toBeCloseTo(0.5, 1);
		expect(state.job?.layer).toEqual({ current: 25, total: 50 });
		expect(state.job?.remainingSec).toBeCloseTo(PRINT_SEC / 2, -1);
		expect(state.fans.part).toBe(1);
		expect(state.filamentUnits[0]?.slots[0]?.active).toBe(true);

		advanceUntil(printer, "finishing");
		expect(printer.getState().job?.progress).toBe(1);

		advanceUntil(printer, "idle");
		state = printer.getState();
		expect(state.job).toBeNull();
		expect(state.temps.tools[0]?.target).toBe(0);
		printer.advance(10_000);
		expect(printer.getState().temps.tools[0]?.current).toBe(190);

		const statuses = states
			.map((s) => s.status)
			.filter((s, i, all) => s !== all[i - 1]);
		expect(statuses).toEqual([
			"idle",
			"preparing",
			"printing",
			"finishing",
			"idle",
		]);
		for (const s of states) expect(printerStateSchema.parse(s)).toEqual(s);
	});

	it("pauses and resumes, with no progress while paused", async () => {
		const { printer } = await printing();
		printer.advance(10_000);

		await printer.execute({ name: "print.pause", params: {} });
		expect(printer.getState().status).toBe("pausing");
		advanceUntil(printer, "paused");

		const progress = printer.getState().job?.progress;
		printer.advance(30_000);
		expect(printer.getState().job?.progress).toBe(progress);

		await printer.execute({ name: "print.resume", params: {} });
		expect(printer.getState().status).toBe("printing");
		printer.advance(5000);
		expect(printer.getState().job?.progress).toBeGreaterThan(progress ?? 1);
	});

	it("cancels a print", async () => {
		const { printer } = await printing();
		await printer.execute({ name: "print.cancel", params: {} });
		expect(printer.getState().status).toBe("cancelling");

		advanceUntil(printer, "idle");
		expect(printer.getState().job).toBeNull();
		expect(printer.getState().temps.bed?.target).toBe(0);
	});

	it("can cancel while still heating", async () => {
		const { printer } = await connected();
		await printer.execute({
			name: "print.start",
			params: { fileName: "benchy.gcode" },
		});
		await printer.execute({ name: "print.cancel", params: {} });
		advanceUntil(printer, "idle");
	});

	it("rejects commands that don't fit the current status", async () => {
		const { printer } = await connected();
		await expectCommandError(
			printer.execute({ name: "print.pause", params: {} }),
			"invalid_state",
		);
		await expectCommandError(
			printer.execute({ name: "print.cancel", params: {} }),
			"invalid_state",
		);

		await printer.execute({
			name: "print.start",
			params: { fileName: "a.gcode" },
		});
		await expectCommandError(
			printer.execute({ name: "print.start", params: { fileName: "b.gcode" } }),
			"invalid_state",
		);
		await expectCommandError(
			printer.execute({ name: "print.resume", params: {} }),
			"invalid_state",
		);
	});

	it("fails on demand and recovers when the error is cleared", async () => {
		const { printer } = await printing();
		printer.injectError("thermal_runaway", "Nozzle temperature out of range");

		let state = printer.getState();
		expect(state.status).toBe("error");
		expect(state.errors).toEqual([
			{
				code: "thermal_runaway",
				message: "Nozzle temperature out of range",
				severity: "error",
			},
		]);
		expect(state.job?.fileName).toBe("benchy.gcode");
		expect(state.temps.tools[0]?.target).toBe(0);
		await expectCommandError(
			printer.execute({ name: "print.resume", params: {} }),
			"invalid_state",
		);

		printer.clearError();
		state = printer.getState();
		expect(state.status).toBe("idle");
		expect(state.job).toBeNull();
		expect(state.errors).toEqual([]);
	});

	it("runs out of filament: pauses, warns and sends an event", async () => {
		const { printer, events } = await printing();
		printer.runOutOfFilament();

		expect(events).toEqual([{ kind: "filament.runout", unit: 0, slot: 0 }]);
		advanceUntil(printer, "paused");
		let state = printer.getState();
		expect(state.errors).toMatchObject([
			{ code: "filament_runout", severity: "warning" },
		]);
		expect(state.filamentUnits[0]?.slots[0]?.reported).toBeNull();

		await printer.execute({ name: "print.resume", params: {} });
		state = printer.getState();
		expect(state.status).toBe("printing");
		expect(state.errors).toEqual([]);
		expect(state.filamentUnits[0]?.slots[0]?.reported).toMatchObject({
			material: "PLA",
		});
	});

	it("only runs out of filament while printing", async () => {
		const { printer } = await connected();
		expect(() => printer.runOutOfFilament()).toThrow();
	});

	it("sends one-off printer errors as events", async () => {
		const { printer, events } = await connected();
		const error = {
			code: "1100",
			message: "Unknown",
			severity: "info",
		} as const;
		printer.announceError(error);
		expect(events).toEqual([{ kind: "printer.error", error }]);
	});

	it("goes offline when unreachable, keeps printing, and comes back", async () => {
		const { printer } = await printing();
		const before = printer.getState().job?.progress ?? 1;

		printer.setReachable(false);
		expect(printer.getState()).toMatchObject({
			status: "offline",
			job: null,
			speedFactor: null,
		});
		expect(await printer.snapshot()).toBeNull();
		await expectCommandError(
			printer.execute({ name: "print.pause", params: {} }),
			"printer_offline",
		);

		printer.advance(20_000);
		printer.setReachable(true);
		expect(printer.getState().status).toBe("printing");
		expect(printer.getState().job?.progress).toBeGreaterThan(before);
	});

	it("rejects commands before connecting and after disconnecting", async () => {
		const printer = new SimulatedPrinter({ autoAdvance: false });
		await expectCommandError(
			printer.execute({ name: "print.start", params: { fileName: "a.gcode" } }),
			"printer_offline",
		);

		await printer.connect();
		await printer.disconnect();
		expect(printer.getState().status).toBe("offline");
		await expectCommandError(
			printer.execute({ name: "print.start", params: { fileName: "a.gcode" } }),
			"printer_offline",
		);
	});

	it("only reports state when something changed", async () => {
		const { printer, states } = await connected();
		const count = states.length;
		printer.advance(60_000);
		expect(states).toHaveLength(count);

		const stop = printer.onStateChange(() => {
			throw new Error("unsubscribed listener was called");
		});
		stop();
		await printer.execute({
			name: "print.start",
			params: { fileName: "a.gcode" },
		});
		expect(states).toHaveLength(count + 1);
	});

	it("gives listeners copies they can't use to change the printer", async () => {
		const { printer, states } = await printing();
		const last = states.at(-1);
		if (!last?.job) throw new Error("expected a job");
		last.job.fileName = "tampered.gcode";
		expect(printer.getState().job?.fileName).toBe("benchy.gcode");
	});

	it("takes PNG camera snapshots that change as the print moves", async () => {
		const { printer } = await printing();
		const first = await printer.snapshot();
		printer.advance(5000);
		const second = await printer.snapshot();

		expect(first?.contentType).toBe("image/png");
		expect(first?.data.subarray(1, 4)).toEqual(new TextEncoder().encode("PNG"));
		expect(second?.data).not.toEqual(first?.data);
	});

	it("has no snapshot without a camera", async () => {
		const { printer } = await connected({ capabilities: { hasCamera: false } });
		expect(await printer.snapshot()).toBeNull();
	});

	it("supports several nozzles", async () => {
		const { printer } = await printing({ toolCount: 2 });
		expect(printer.getState().temps.tools).toEqual([
			{ current: 220, target: 220 },
			{ current: 220, target: 220 },
		]);
	});

	it("advances on its own with a real timer", async () => {
		const printer = new SimulatedPrinter({ tickMs: 5, timeScale: 1000 });
		await printer.connect();
		await printer.execute({
			name: "print.start",
			params: { fileName: "a.gcode" },
		});
		await new Promise((resolve) => setTimeout(resolve, 100));

		// 100 ms at 1000× is 100 simulated seconds: well past heating up.
		expect(printer.getState().job?.progress).toBeGreaterThan(0);
		await printer.disconnect();
	});
});
