import {
	diffState,
	isEmptyPatch,
	type PrinterCapabilities,
	type PrinterCommand,
	type PrinterError,
	type PrinterEvent,
	type PrinterState,
	type PrinterStatus,
	type ReportedFilament,
} from "@ops/protocol";
import {
	type CameraFrame,
	CommandError,
	type PrinterDriver,
	type Unsubscribe,
} from "../driver.ts";
import { renderSnapshot } from "./camera.ts";

export type SimulatedPrinterOptions = {
	/** Overrides for the default capabilities, e.g. `{ hasCamera: false }`. */
	capabilities?: Partial<PrinterCapabilities>;
	/** Number of nozzles. Default 1. */
	toolCount?: number;
	/** What each slot of the single filament unit holds. Default: four loaded slots. */
	filament?: (ReportedFilament | null)[];
	/** How long a print takes once heated. Default 15 minutes. */
	printDurationSec?: number;
	layerCount?: number;
	/** °C. Default 220 nozzle, 60 bed. */
	printTemps?: { tool: number; bed: number };
	ambientTemp?: number;
	/** °C per second. */
	heatRate?: { tool: number; bed: number };
	coolRate?: { tool: number; bed: number };
	/** How long pausing, finishing and cancelling take. Default 2 seconds. */
	transitionSec?: number;
	/**
	 * Advance on a real timer while connected. Default true.
	 * Tests turn this off and call `advance()` to control time exactly.
	 */
	autoAdvance?: boolean;
	tickMs?: number;
	/** Simulated seconds per real second when auto-advancing. Default 1. */
	timeScale?: number;
};

type ActiveStatus = Exclude<PrinterStatus, "offline">;

type Heater = { current: number; target: number };

type Job = { fileName: string; elapsedSec: number; printedSec: number };

/** Capabilities flags are only true for what the simulator actually does. */
const DEFAULT_CAPABILITIES: PrinterCapabilities = {
	buildVolume: { x: 256, y: 256, z: 256 },
	maxTemps: { tool: 300, bed: 110 },
	canSkipObjects: false,
	canBedMesh: false,
	canGcodeConsole: false,
	canFilamentLoadUnload: false,
	canSlotMapping: false,
	hasCamera: true,
};

const DEFAULT_FILAMENT: ReportedFilament[] = [
	{ material: "PLA", colour: "#F07820" },
	{ material: "PLA", colour: "#FFFFFF" },
	{ material: "PETG", colour: "#202020" },
	{ material: "PLA", colour: "#2060E0" },
];

const OFFLINE_STATE: PrinterState = {
	status: "offline",
	job: null,
	temps: { tools: [], bed: null, chamber: null },
	fans: { part: null, aux: null, chamber: null },
	speedFactor: null,
	flowFactor: null,
	filamentUnits: [],
	errors: [],
};

const RUNOUT_CODE = "filament_runout";

/**
 * A fake printer for development and tests. It heats up, prints with progress and layers,
 * pauses, resumes and cancels, and can be made to fail, run out of filament or drop off the
 * network on demand. Its camera returns a PNG drawn from the current state.
 *
 * Time only moves in `advance()`, so tests are deterministic. With `autoAdvance` (the default)
 * a timer calls it while connected.
 */
export class SimulatedPrinter implements PrinterDriver {
	private readonly capabilities: PrinterCapabilities;
	private readonly durationSec: number;
	private readonly layerCount: number;
	private readonly printTemps: { tool: number; bed: number };
	private readonly ambient: number;
	private readonly heatRate: { tool: number; bed: number };
	private readonly coolRate: { tool: number; bed: number };
	private readonly transitionSec: number;
	private readonly autoAdvance: boolean;
	private readonly tickMs: number;
	private readonly timeScale: number;

	private connected = false;
	private reachable = true;
	private timer: ReturnType<typeof setInterval> | undefined;
	private clockSec = 0;

	private status: ActiveStatus = "idle";
	private job: Job | null = null;
	private phaseSec = 0;
	private tools: Heater[];
	private bed: Heater;
	private slots: (ReportedFilament | null)[];
	private activeSlot = 0;
	private runout: { slot: number; filament: ReportedFilament | null } | null =
		null;
	private errors: PrinterError[] = [];

	private lastEmitted: PrinterState = OFFLINE_STATE;
	private readonly stateListeners = new Set<(state: PrinterState) => void>();
	private readonly eventListeners = new Set<(event: PrinterEvent) => void>();

	constructor(options: SimulatedPrinterOptions = {}) {
		this.capabilities = { ...DEFAULT_CAPABILITIES, ...options.capabilities };
		this.durationSec = options.printDurationSec ?? 15 * 60;
		this.layerCount = options.layerCount ?? 150;
		this.printTemps = options.printTemps ?? { tool: 220, bed: 60 };
		this.ambient = options.ambientTemp ?? 22;
		this.heatRate = options.heatRate ?? { tool: 8, bed: 2 };
		this.coolRate = options.coolRate ?? { tool: 3, bed: 0.5 };
		this.transitionSec = options.transitionSec ?? 2;
		this.autoAdvance = options.autoAdvance ?? true;
		this.tickMs = options.tickMs ?? 500;
		this.timeScale = options.timeScale ?? 1;

		const heater = () => ({ current: this.ambient, target: 0 });
		this.tools = Array.from({ length: options.toolCount ?? 1 }, heater);
		this.bed = heater();
		this.slots = [...(options.filament ?? DEFAULT_FILAMENT)];
	}

	// PrinterDriver

	async connect(): Promise<void> {
		this.connected = true;
		if (this.autoAdvance && !this.timer) {
			let last = performance.now();
			this.timer = setInterval(() => {
				const now = performance.now();
				this.advance((now - last) * this.timeScale);
				last = now;
			}, this.tickMs);
		}
		this.emitIfChanged();
	}

	async disconnect(): Promise<void> {
		clearInterval(this.timer);
		this.timer = undefined;
		this.connected = false;
		this.emitIfChanged();
	}

	getCapabilities(): PrinterCapabilities {
		return structuredClone(this.capabilities);
	}

	getState(): PrinterState {
		return this.buildState();
	}

	onStateChange(listener: (state: PrinterState) => void): Unsubscribe {
		this.stateListeners.add(listener);
		return () => this.stateListeners.delete(listener);
	}

	onEvent(listener: (event: PrinterEvent) => void): Unsubscribe {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	async execute(command: PrinterCommand): Promise<void> {
		if (!this.isOnline()) {
			throw new CommandError("printer_offline", "The printer is offline");
		}

		switch (command.name) {
			case "print.start":
				this.requireStatus(command.name, "idle");
				this.job = {
					fileName: command.params.fileName,
					elapsedSec: 0,
					printedSec: 0,
				};
				for (const tool of this.tools) tool.target = this.printTemps.tool;
				this.bed.target = this.printTemps.bed;
				this.status = "preparing";
				break;
			case "print.pause":
				this.requireStatus(command.name, "printing");
				this.enterPhase("pausing");
				break;
			case "print.resume":
				this.requireStatus(command.name, "paused");
				this.resolveRunout();
				this.status = "printing";
				break;
			case "print.cancel":
				this.requireStatus(
					command.name,
					"preparing",
					"printing",
					"pausing",
					"paused",
				);
				this.resolveRunout();
				this.enterPhase("cancelling");
				break;
		}
		this.emitIfChanged();
	}

	async snapshot(): Promise<CameraFrame | null> {
		if (!this.capabilities.hasCamera || !this.isOnline()) return null;
		return {
			contentType: "image/png",
			data: renderSnapshot(this.buildState(), this.clockSec),
			capturedAt: Date.now(),
		};
	}

	// Simulation controls

	/** Moves simulated time forward. */
	advance(ms: number): void {
		let remainingSec = ms / 1000;
		// Step at most a second at a time, so phase changes land close to when they're due.
		while (remainingSec > 0) {
			const dt = Math.min(remainingSec, 1);
			this.step(dt);
			remainingSec -= dt;
		}
		this.emitIfChanged();
	}

	/** Makes the printer fail: it stops, turns its heaters off and reports the error. */
	injectError(code = "simulated_failure", message = "Simulated failure"): void {
		this.errors.push({ code, message, severity: "error" });
		this.status = "error";
		this.heatersOff();
		this.emitIfChanged();
	}

	/** Like pressing OK on the printer's screen after an error. The failed job is dropped. */
	clearError(): void {
		if (this.status !== "error") return;
		this.resolveRunout();
		this.errors = [];
		this.job = null;
		this.status = "idle";
		this.emitIfChanged();
	}

	/**
	 * The runout sensor fires mid-print: the active slot empties, the printer pauses with a
	 * warning, and a `filament.runout` event is sent. Resuming or cancelling counts as the
	 * filament having been reloaded.
	 */
	runOutOfFilament(): void {
		if (this.status !== "printing") {
			throw new Error(
				`Can only run out of filament while printing, not ${this.status}`,
			);
		}
		this.runout = {
			slot: this.activeSlot,
			filament: this.slots[this.activeSlot] ?? null,
		};
		this.slots[this.activeSlot] = null;
		this.errors.push({
			code: RUNOUT_CODE,
			message: "Filament ran out",
			severity: "warning",
		});
		this.enterPhase("pausing");
		this.emitIfChanged();
		this.emitEvent({ kind: "filament.runout", unit: 0, slot: this.activeSlot });
	}

	/** Sends a one-off `printer.error` event without changing state. */
	announceError(error: PrinterError): void {
		this.emitEvent({ kind: "printer.error", error });
	}

	/** Takes the printer off the network (status "offline") or brings it back. It keeps printing meanwhile. */
	setReachable(reachable: boolean): void {
		this.reachable = reachable;
		this.emitIfChanged();
	}

	// Internals

	private isOnline(): boolean {
		return this.connected && this.reachable;
	}

	private requireStatus(command: string, ...allowed: ActiveStatus[]): void {
		if (!allowed.includes(this.status)) {
			throw new CommandError(
				"invalid_state",
				`Can't run ${command} while ${this.status}`,
			);
		}
	}

	private enterPhase(status: "pausing" | "finishing" | "cancelling"): void {
		this.status = status;
		this.phaseSec = 0;
	}

	private heatersOff(): void {
		for (const tool of this.tools) tool.target = 0;
		this.bed.target = 0;
	}

	private resolveRunout(): void {
		if (!this.runout) return;
		this.slots[this.runout.slot] = this.runout.filament;
		this.errors = this.errors.filter((error) => error.code !== RUNOUT_CODE);
		this.runout = null;
	}

	private step(dt: number): void {
		this.clockSec += dt;
		for (const tool of this.tools) this.stepHeater(tool, "tool", dt);
		this.stepHeater(this.bed, "bed", dt);

		if (this.job && this.status !== "paused" && this.status !== "error") {
			this.job.elapsedSec += dt;
		}

		switch (this.status) {
			case "preparing":
				if (this.heatersReady()) this.status = "printing";
				break;
			case "printing":
				if (!this.job) break;
				this.job.printedSec = Math.min(
					this.durationSec,
					this.job.printedSec + dt,
				);
				if (this.job.printedSec >= this.durationSec)
					this.enterPhase("finishing");
				break;
			case "pausing":
				this.phaseSec += dt;
				if (this.phaseSec >= this.transitionSec) this.status = "paused";
				break;
			case "finishing":
			case "cancelling":
				this.phaseSec += dt;
				if (this.phaseSec >= this.transitionSec) {
					this.job = null;
					this.heatersOff();
					this.status = "idle";
				}
				break;
		}
	}

	private stepHeater(heater: Heater, kind: "tool" | "bed", dt: number): void {
		const goal = heater.target > 0 ? heater.target : this.ambient;
		if (heater.current < goal) {
			heater.current = Math.min(
				goal,
				heater.current + this.heatRate[kind] * dt,
			);
		} else {
			heater.current = Math.max(
				goal,
				heater.current - this.coolRate[kind] * dt,
			);
		}
	}

	private heatersReady(): boolean {
		return [...this.tools, this.bed].every(
			(heater) => heater.current >= heater.target,
		);
	}

	private buildState(): PrinterState {
		if (!this.isOnline()) return structuredClone(OFFLINE_STATE);

		const progress = this.job ? this.job.printedSec / this.durationSec : 0;
		const layer = this.job
			? Math.min(this.layerCount, Math.ceil(progress * this.layerCount))
			: 0;
		const temp = (heater: Heater) => ({
			current: Math.round(heater.current * 10) / 10,
			target: heater.target,
		});

		return {
			status: this.status,
			job: this.job && {
				fileName: this.job.fileName,
				progress,
				layer: { current: layer, total: this.layerCount },
				elapsedSec: Math.round(this.job.elapsedSec),
				remainingSec: Math.round(this.durationSec - this.job.printedSec),
			},
			temps: {
				tools: this.tools.map(temp),
				bed: temp(this.bed),
				chamber: null,
			},
			// Part cooling is off for the first layer, as most slicers do.
			fans: { part: layer > 1 ? 1 : 0, aux: null, chamber: null },
			speedFactor: 1,
			flowFactor: null,
			filamentUnits: [
				{
					slots: this.slots.map((reported, i) => ({
						reported: reported && { ...reported },
						active: this.job !== null && i === this.activeSlot,
					})),
				},
			],
			errors: this.errors.map((error) => ({ ...error })),
		};
	}

	private emitIfChanged(): void {
		const state = this.buildState();
		if (isEmptyPatch(diffState(this.lastEmitted, state))) return;
		this.lastEmitted = state;
		for (const listener of this.stateListeners)
			listener(structuredClone(state));
	}

	private emitEvent(event: PrinterEvent): void {
		for (const listener of this.eventListeners)
			listener(structuredClone(event));
	}
}
