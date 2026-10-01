import { describe, expect, it } from "vitest";
import { app } from "./app.ts";

describe("GET /health", () => {
	it("reports the API is up", async () => {
		const res = await app.request("/health");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});
});
