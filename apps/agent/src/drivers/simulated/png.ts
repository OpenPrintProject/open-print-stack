import { deflateSync } from "node:zlib";

export type Rgb = readonly [number, number, number];

/** A tiny RGB drawing surface, enough for the simulated camera. */
export class Canvas {
	readonly pixels: Uint8Array;

	constructor(
		readonly width: number,
		readonly height: number,
	) {
		this.pixels = new Uint8Array(width * height * 3);
	}

	/** Fills a rectangle, clipped to the canvas. */
	fillRect(x: number, y: number, w: number, h: number, colour: Rgb): void {
		const x0 = Math.max(0, Math.round(x));
		const y0 = Math.max(0, Math.round(y));
		const x1 = Math.min(this.width, Math.round(x + w));
		const y1 = Math.min(this.height, Math.round(y + h));
		for (let row = y0; row < y1; row++) {
			for (let col = x0; col < x1; col++) {
				this.pixels.set(colour, (row * this.width + col) * 3);
			}
		}
	}

	toPng(): Uint8Array {
		return encodePng(this.width, this.height, this.pixels);
	}
}

/** "#RRGGBB" → RGB, or `fallback` if it isn't in that form. */
export function parseHexColour(hex: string | undefined, fallback: Rgb): Rgb {
	const match = hex?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	if (!match) return fallback;
	return [
		Number.parseInt(match[1] ?? "", 16),
		Number.parseInt(match[2] ?? "", 16),
		Number.parseInt(match[3] ?? "", 16),
	];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Encodes 8-bit RGB pixels (row by row, no padding) as a PNG. */
export function encodePng(
	width: number,
	height: number,
	rgb: Uint8Array,
): Uint8Array {
	const stride = width * 3;
	// Each row starts with a filter-type byte; 0 means no filter.
	const raw = new Uint8Array((stride + 1) * height);
	for (let row = 0; row < height; row++) {
		raw.set(
			rgb.subarray(row * stride, (row + 1) * stride),
			row * (stride + 1) + 1,
		);
	}

	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header[8] = 8; // bit depth
	header[9] = 2; // colour type: RGB
	// Bytes 10–12 (compression, filter and interlace methods) are all 0.

	return concat([
		new Uint8Array(PNG_SIGNATURE),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", new Uint8Array(0)),
	]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(new TextEncoder().encode(type), 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

export function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
