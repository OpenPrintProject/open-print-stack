import { z } from "zod";

// The common printer format every driver reports. See "Printer state model" in docs/architecture.md.
// Units: °C, mm, seconds, grams. Ratios are 0–1. `null` means "this printer doesn't report this", never 0.

const ratio = z.number().min(0).max(1);
const count = z.int().nonnegative();

export const printerStatusSchema = z.enum([
	"offline",
	"idle",
	"preparing",
	"printing",
	"pausing",
	"paused",
	"finishing",
	"cancelling",
	"error",
]);

export type PrinterStatus = z.infer<typeof printerStatusSchema>;

const heaterSchema = z.object({
	current: z.number(),
	target: z.number(),
});

const layerSchema = z.object({
	current: count,
	total: count,
});

const jobSchema = z.object({
	fileName: z.string().min(1),
	progress: ratio,
	layer: layerSchema.nullable(),
	elapsedSec: z.number().nonnegative(),
	/** The printer's own estimate. */
	remainingSec: z.number().nonnegative().nullable(),
});

const tempsSchema = z.object({
	/** One per nozzle. */
	tools: z.array(heaterSchema),
	bed: heaterSchema.nullable(),
	chamber: heaterSchema.nullable(),
});

const fansSchema = z.object({
	part: ratio.nullable(),
	aux: ratio.nullable(),
	chamber: ratio.nullable(),
});

/** What the printer says is loaded. The Spool we've assigned to the slot is tracked separately, in the cloud. */
export const reportedFilamentSchema = z.object({
	material: z.string().optional(),
	/** "#RRGGBB" */
	colour: z.string().optional(),
	/** Grams. */
	remaining: z.number().nonnegative().optional(),
	tagUid: z.string().optional(),
});

export type ReportedFilament = z.infer<typeof reportedFilamentSchema>;

const filamentUnitSchema = z.object({
	slots: z.array(
		z.object({
			reported: reportedFilamentSchema.nullable(),
			active: z.boolean(),
		}),
	),
});

export const printerErrorSchema = z.object({
	code: z.string().min(1),
	message: z.string(),
	severity: z.enum(["info", "warning", "error"]),
});

export type PrinterError = z.infer<typeof printerErrorSchema>;

export const printerStateSchema = z.object({
	status: printerStatusSchema,
	/** The current print, or null when no print is active. */
	job: jobSchema.nullable(),
	temps: tempsSchema,
	fans: fansSchema,
	/** 1 = 100%. */
	speedFactor: z.number().nonnegative().nullable(),
	flowFactor: z.number().nonnegative().nullable(),
	filamentUnits: z.array(filamentUnitSchema),
	errors: z.array(printerErrorSchema),
});

export type PrinterState = z.infer<typeof printerStateSchema>;

/**
 * A change to a PrinterState: any subset of its fields, nested objects included.
 * Arrays are always sent whole. `null` sets a field to null (unknown or absent); it never deletes it.
 */
export const statePatchSchema = printerStateSchema.partial().extend({
	job: jobSchema
		.partial()
		.extend({ layer: layerSchema.partial().nullable().optional() })
		.nullable()
		.optional(),
	temps: tempsSchema
		.partial()
		.extend({
			bed: heaterSchema.partial().nullable().optional(),
			chamber: heaterSchema.partial().nullable().optional(),
		})
		.optional(),
	fans: fansSchema.partial().optional(),
});

export type StatePatch = z.infer<typeof statePatchSchema>;

/** Fixed facts about a printer. They drive which controls the UI shows, never the brand. */
export const printerCapabilitiesSchema = z.object({
	/** mm */
	buildVolume: z.object({
		x: z.number().positive(),
		y: z.number().positive(),
		z: z.number().positive(),
	}),
	/** °C */
	maxTemps: z.object({
		tool: z.number().positive(),
		bed: z.number().positive(),
		chamber: z.number().positive().optional(),
	}),
	canSkipObjects: z.boolean(),
	canBedMesh: z.boolean(),
	canGcodeConsole: z.boolean(),
	canFilamentLoadUnload: z.boolean(),
	/** e.g. Bambu AMS or CANVAS mapping at print start. */
	canSlotMapping: z.boolean(),
	hasCamera: z.boolean(),
});

export type PrinterCapabilities = z.infer<typeof printerCapabilitiesSchema>;
