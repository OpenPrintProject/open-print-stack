import { createDb } from "@ops/db";
import { afterAll, inject } from "vitest";
import { createApp } from "../app.ts";
import { createAuth } from "../auth/index.ts";

export const APP_URL = "http://localhost:5173";

/** An app backed by the test database. Closes its connection after the file's tests. */
export function createTestApp() {
	const db = createDb(inject("databaseUrl"));
	afterAll(() => db.$client.end());

	const auth = createAuth({
		db,
		baseURL: APP_URL,
		secret: "test-secret-that-is-at-least-32-characters",
	});
	return { db, auth, app: createApp({ auth }) };
}

/** An email no other test uses, so test files can share the database. */
export function uniqueEmail(): string {
	return `${crypto.randomUUID()}@example.com`;
}

/** The `name=value` pairs from a response's Set-Cookie headers, ready to send back. */
export function cookiesFrom(res: Response): string {
	return res.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");
}
