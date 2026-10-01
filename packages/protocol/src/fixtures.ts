// Sample data for this package's tests.
import type { PrinterCapabilities, PrinterState } from "./state.ts";

export const idleState: PrinterState = {
	status: "idle",
	job: null,
	temps: {
		tools: [{ current: 24, target: 0 }],
		bed: { current: 23, target: 0 },
		chamber: null,
	},
	fans: { part: 0, aux: null, chamber: null },
	speedFactor: 1,
	flowFactor: null,
	filamentUnits: [
		{
			slots: [
				{ reported: { material: "PLA", colour: "#FFFFFF" }, active: false },
				{ reported: null, active: false },
			],
		},
	],
	errors: [],
};

export const printingState: PrinterState = {
	...idleState,
	status: "printing",
	job: {
		fileName: "benchy.gcode",
		progress: 0.25,
		layer: { current: 30, total: 120 },
		elapsedSec: 600,
		remainingSec: 1800,
	},
	temps: {
		tools: [{ current: 219.5, target: 220 }],
		bed: { current: 60, target: 60 },
		chamber: null,
	},
	fans: { part: 1, aux: null, chamber: null },
	filamentUnits: [
		{
			slots: [
				{ reported: { material: "PLA", colour: "#FFFFFF" }, active: true },
				{ reported: null, active: false },
			],
		},
	],
};

export const capabilities: PrinterCapabilities = {
	buildVolume: { x: 256, y: 256, z: 256 },
	maxTemps: { tool: 350, bed: 110 },
	canSkipObjects: false,
	canBedMesh: true,
	canGcodeConsole: false,
	canFilamentLoadUnload: true,
	canSlotMapping: true,
	hasCamera: true,
};
