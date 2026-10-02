import { describe, expect, it } from "vitest";
import { createTestApp } from "./test/helpers.ts";

const { app } = createTestApp();

describe("GET /api/health", () => {
	it("reports the API is up", async () => {
		const res = await app.request("/api/health");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});
});
