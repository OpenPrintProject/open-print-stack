import { describe, expect, it } from "vitest";
import { newId } from "./ids.ts";

describe("newId", () => {
	it("starts with the prefix and uses only the readable alphabet", () => {
		expect(newId("usr")).toMatch(/^usr_[0-9a-hjkmnp-tv-z]{26}$/);
	});

	it("doesn't repeat", () => {
		const ids = new Set(Array.from({ length: 1000 }, () => newId("acc")));
		expect(ids.size).toBe(1000);
	});
});
