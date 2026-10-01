import type { PrinterState, PrinterStatus } from "@ops/protocol";
import { Canvas, parseHexColour, type Rgb } from "./png.ts";

const WIDTH = 320;
const HEIGHT = 240;

const STATUS_COLOURS: Record<PrinterStatus, Rgb> = {
	offline: [60, 60, 60],
	idle: [128, 128, 128],
	preparing: [224, 160, 48],
	printing: [64, 192, 96],
	pausing: [64, 128, 224],
	paused: [64, 128, 224],
	finishing: [64, 192, 192],
	cancelling: [192, 128, 64],
	error: [224, 64, 64],
};

const BACKGROUND: Rgb = [30, 30, 30];
const TRACK: Rgb = [58, 58, 58];
const BED: Rgb = [90, 90, 90];
const NOZZLE: Rgb = [200, 200, 200];
const DEFAULT_FILAMENT: Rgb = [240, 120, 32];

/**
 * Draws a picture of the simulated printer: a status-coloured border, a progress bar, the bed,
 * the part growing layer by layer in the active filament's colour, and the moving nozzle.
 * `timeSec` moves the nozzle, so consecutive frames during a print differ.
 */
export function renderSnapshot(
	state: PrinterState,
	timeSec: number,
): Uint8Array {
	const canvas = new Canvas(WIDTH, HEIGHT);
	const statusColour = STATUS_COLOURS[state.status];
	const progress = state.job?.progress ?? 0;

	canvas.fillRect(0, 0, WIDTH, HEIGHT, statusColour);
	canvas.fillRect(6, 6, WIDTH - 12, HEIGHT - 12, BACKGROUND);

	canvas.fillRect(16, 16, WIDTH - 32, 8, TRACK);
	canvas.fillRect(16, 16, (WIDTH - 32) * progress, 8, statusColour);

	const bedTop = 200;
	canvas.fillRect(60, bedTop, 200, 10, BED);

	const activeSlot = state.filamentUnits
		.flatMap((unit) => unit.slots)
		.find((slot) => slot.active);
	const filament = parseHexColour(
		activeSlot?.reported?.colour,
		DEFAULT_FILAMENT,
	);
	const partHeight = 150 * progress;
	canvas.fillRect(110, bedTop - partHeight, 100, partHeight, filament);

	const moving = state.status === "printing";
	const nozzleX = moving ? 150 + Math.sin(timeSec) * 60 : 30;
	const nozzleY = moving ? bedTop - partHeight - 16 : 40;
	canvas.fillRect(nozzleX, nozzleY, 20, 16, NOZZLE);

	return canvas.toPng();
}
