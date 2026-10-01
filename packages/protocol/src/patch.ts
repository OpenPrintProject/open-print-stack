import {
	type PrinterState,
	printerStateSchema,
	type StatePatch,
} from "./state.ts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEqual(a: Json | undefined, b: Json | undefined): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((item, i) => isEqual(item, b[i]));
	}
	if (isObject(a) && isObject(b)) {
		const keys = Object.keys(a);
		return (
			keys.length === Object.keys(b).length &&
			keys.every((key) => isEqual(a[key], b[key]))
		);
	}
	return false;
}

function diff(prev: Json | undefined, next: Json): Json | undefined {
	if (isObject(prev) && isObject(next)) {
		const out: JsonObject = {};
		for (const [key, value] of Object.entries(next)) {
			const changed = diff(prev[key], value);
			if (changed !== undefined) out[key] = changed;
		}
		return Object.keys(out).length > 0 ? out : undefined;
	}
	return isEqual(prev, next) ? undefined : structuredClone(next);
}

function merge(base: Json | undefined, patch: Json): Json {
	if (isObject(base) && isObject(patch)) {
		const out: JsonObject = { ...base };
		for (const [key, value] of Object.entries(patch)) {
			out[key] = merge(base[key], value);
		}
		return out;
	}
	return structuredClone(patch);
}

/** The fields that changed from `prev` to `next`. Empty when nothing changed. */
export function diffState(prev: PrinterState, next: PrinterState): StatePatch {
	return (diff(prev, next) ?? {}) as StatePatch;
}

export function isEmptyPatch(patch: StatePatch): boolean {
	return Object.keys(patch).length === 0;
}

/**
 * Applies a patch and checks the result is a valid state. Throws if it isn't,
 * e.g. a partial `job` sent while no job was known; the sender should then send a snapshot.
 */
export function applyStatePatch(
	state: PrinterState,
	patch: StatePatch,
): PrinterState {
	return printerStateSchema.parse(merge(state, patch as Json));
}
