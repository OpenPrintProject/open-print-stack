import type {
	CommandErrorCode,
	PrinterCapabilities,
	PrinterCommand,
	PrinterEvent,
	PrinterState,
} from "@ops/protocol";

/**
 * What every printer brand implements. A driver turns one printer's own protocol into the
 * common state format and carries out commands; it makes no decisions of its own.
 *
 * Drivers always report a full state. Working out patches and deciding how often to send
 * telemetry is done once, by the agent, for every driver.
 */
export interface PrinterDriver {
	/** Opens the connection to the printer. Resolves once state and capabilities are known. */
	connect(): Promise<void>;
	disconnect(): Promise<void>;

	/** Valid after `connect()` resolves. */
	getCapabilities(): PrinterCapabilities;
	/** The latest full state. Status is "offline" while the printer can't be reached. */
	getState(): PrinterState;
	/** Called with the full state whenever anything in it changes. */
	onStateChange(listener: (state: PrinterState) => void): Unsubscribe;
	/** Events that can't be worked out from state, e.g. a filament runout sensor firing. */
	onEvent(listener: (event: PrinterEvent) => void): Unsubscribe;

	/**
	 * Resolves once the printer has accepted the command, not when it has finished acting on it.
	 * Rejects with a `CommandError`.
	 */
	execute(command: PrinterCommand): Promise<void>;

	/** The latest camera frame, or null if the printer has no camera or it isn't available. */
	snapshot(): Promise<CameraFrame | null>;
}

export type Unsubscribe = () => void;

export type CameraFrame = {
	contentType: string;
	data: Uint8Array;
	/** Unix milliseconds. */
	capturedAt: number;
};

/** A command failure, reported back to the cloud as a `cmd.result` error. */
export class CommandError extends Error {
	override readonly name = "CommandError";

	constructor(
		readonly code: CommandErrorCode,
		message: string,
	) {
		super(message);
	}
}
