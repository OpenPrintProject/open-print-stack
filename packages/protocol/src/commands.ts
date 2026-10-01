import { z } from "zod";

/**
 * Parameters for each command the cloud can send to a printer. The message type is `cmd.<name>`.
 * The list grows driver by driver, following the capability flags.
 */
export const commandParamsSchemas = {
	"print.start": z.object({
		/** A file already on the printer. */
		fileName: z.string().min(1),
	}),
	"print.pause": z.object({}),
	"print.resume": z.object({}),
	"print.cancel": z.object({}),
};

export type CommandName = keyof typeof commandParamsSchemas;

/** A command as a driver receives it. */
export type PrinterCommand = {
	[K in CommandName]: {
		name: K;
		params: z.infer<(typeof commandParamsSchemas)[K]>;
	};
}[CommandName];

export const commandErrorCodeSchema = z.enum([
	/** The printer or its agent isn't connected. Commands are never queued. */
	"printer_offline",
	"unknown_printer",
	/** The printer's capabilities don't include this command. */
	"not_supported",
	/** The printer can't do this right now, e.g. pausing while idle. */
	"invalid_state",
	"invalid_params",
	/** The command is refused outright for safety, e.g. a firmware flash. */
	"blocked",
	"timeout",
	/** The printer rejected the command or the driver hit an error. */
	"failed",
]);

export type CommandErrorCode = z.infer<typeof commandErrorCodeSchema>;

export const commandResultSchema = z.discriminatedUnion("ok", [
	z.object({ ok: z.literal(true) }),
	z.object({
		ok: z.literal(false),
		error: z.object({
			code: commandErrorCodeSchema,
			message: z.string(),
		}),
	}),
]);

export type CommandResult = z.infer<typeof commandResultSchema>;
