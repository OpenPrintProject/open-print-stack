import { describe, expect, it } from "bun:test";
import { inflateSync } from "node:zlib";
import { Canvas, crc32, parseHexColour } from "./png.ts";

function readChunks(png: Uint8Array) {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	const chunks: { type: string; data: Uint8Array; crcOk: boolean }[] = [];
	let offset = 8;
	while (offset < png.length) {
		const length = view.getUint32(offset);
		const body = png.subarray(offset + 4, offset + 8 + length);
		chunks.push({
			type: new TextDecoder().decode(body.subarray(0, 4)),
			data: body.subarray(4),
			crcOk: crc32(body) === view.getUint32(offset + 8 + length),
		});
		offset += 12 + length;
	}
	return chunks;
}

describe("PNG encoding", () => {
	it("computes the standard CRC-32", () => {
		expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
	});

	it("writes a valid PNG that decodes back to the drawn pixels", () => {
		const canvas = new Canvas(4, 3);
		canvas.fillRect(1, 1, 2, 1, [255, 0, 0]);
		const png = canvas.toPng();

		expect([...png.subarray(0, 8)]).toEqual([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		]);
		const chunks = readChunks(png);
		expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
		expect(chunks.every((c) => c.crcOk)).toBe(true);

		const header = new DataView(
			chunks[0]?.data.buffer ?? new ArrayBuffer(0),
			chunks[0]?.data.byteOffset,
		);
		expect(header.getUint32(0)).toBe(4);
		expect(header.getUint32(4)).toBe(3);

		const raw = inflateSync(chunks[1]?.data ?? new Uint8Array());
		// Row 1: filter byte, then pixels 0–3. Pixels 1 and 2 are red.
		const row1 = [...raw.subarray(13 + 1, 26)];
		expect(row1).toEqual([0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 0]);
	});

	it("clips rectangles to the canvas", () => {
		const canvas = new Canvas(2, 2);
		canvas.fillRect(-5, -5, 100, 100, [1, 2, 3]);
		expect([...canvas.pixels]).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]);
	});

	it("parses hex colours, falling back when invalid", () => {
		expect(parseHexColour("#FF8000", [0, 0, 0])).toEqual([255, 128, 0]);
		expect(parseHexColour("orange", [1, 2, 3])).toEqual([1, 2, 3]);
		expect(parseHexColour(undefined, [1, 2, 3])).toEqual([1, 2, 3]);
	});
});
