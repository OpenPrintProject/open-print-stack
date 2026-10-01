import { z } from "zod";
import { printerErrorSchema } from "./state.ts";

/**
 * Events a driver sends explicitly. Most events (print started, finished, failed...) are worked out
 * by the cloud from state changes; these are the ones state can't show.
 */
export const printerEventSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("filament.runout"),
		/** Index into `filamentUnits`, or null if the printer doesn't say. */
		unit: z.int().nonnegative().nullable(),
		slot: z.int().nonnegative().nullable(),
	}),
	/** A one-off error the printer announced. Lasting errors are in `PrinterState.errors`. */
	z.object({
		kind: z.literal("printer.error"),
		error: printerErrorSchema,
	}),
]);

export type PrinterEvent = z.infer<typeof printerEventSchema>;
