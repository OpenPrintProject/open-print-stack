import { schema } from "@ops/db";
import { eq, notExists, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
	APP_URL,
	cookiesFrom,
	createTestApp,
	uniqueEmail,
} from "../test/helpers.ts";

const { app, db } = createTestApp();
const PASSWORD = "correct horse battery";

function post(
	path: string,
	body: unknown,
	headers: Record<string, string> = {},
) {
	return app.request(path, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: APP_URL,
			...headers,
		},
		body: JSON.stringify(body),
	});
}

function signUp(email = uniqueEmail(), password = PASSWORD) {
	return post("/api/auth/sign-up/email", { name: "Rob", email, password });
}

function signIn(email: string, password = PASSWORD) {
	return post("/api/auth/sign-in/email", { email, password });
}

type Me = {
	user: { id: string; name: string; email: string };
	accountId: string;
};

function me(cookie: string) {
	return app.request("/api/me", { headers: { cookie } });
}

async function meJson(cookie: string): Promise<Me> {
	return (await me(cookie)).json() as Promise<Me>;
}

describe("sign up", () => {
	it("creates a user who owns a new account, and signs them in", async () => {
		const email = uniqueEmail();
		const res = await signUp(email);
		expect(res.status).toBe(200);

		const body = await meJson(cookiesFrom(res));
		expect(body).toEqual({
			user: { id: expect.stringMatching(/^usr_/), name: "Rob", email },
			accountId: expect.stringMatching(/^acc_/),
		});

		const [account] = await db
			.select()
			.from(schema.account)
			.where(eq(schema.account.id, body.accountId));
		expect(account).toBeDefined();
	});

	it("gives each sign-up its own account", async () => {
		const first = await meJson(cookiesFrom(await signUp()));
		const second = await meJson(cookiesFrom(await signUp()));

		expect(first.accountId).not.toBe(second.accountId);
	});

	it("stores a hash, not the password", async () => {
		const email = uniqueEmail();
		await signUp(email);

		const [login] = await db
			.select({ password: schema.authAccount.password })
			.from(schema.authAccount)
			.innerJoin(schema.user, eq(schema.user.id, schema.authAccount.userId))
			.where(eq(schema.user.email, email));
		expect(login?.password).toBeTruthy();
		expect(login?.password).not.toContain(PASSWORD);
	});

	it("rejects an email that's already registered", async () => {
		const email = uniqueEmail();
		await signUp(email);

		const res = await signUp(email);
		expect(res.status).toBe(422);
	});

	it("rejects a password shorter than 8 characters", async () => {
		const res = await signUp(uniqueEmail(), "short");
		expect(res.status).toBe(400);
	});

	it("ignores an accountId sent by the client", async () => {
		const res = await post("/api/auth/sign-up/email", {
			name: "Rob",
			email: uniqueEmail(),
			password: PASSWORD,
			accountId: "acc_someone_else",
		});

		expect(res.status).toBe(400);
	});

	it("never leaves an account without an owner, even when sign-ups race", async () => {
		const email = uniqueEmail();
		const results = await Promise.all([signUp(email), signUp(email)]);
		expect(results.filter((res) => res.ok)).toHaveLength(1);

		const orphans = await db
			.select({ id: schema.account.id })
			.from(schema.account)
			.where(
				notExists(
					db
						.select({ one: sql`1` })
						.from(schema.user)
						.where(eq(schema.user.accountId, schema.account.id)),
				),
			);
		expect(orphans).toEqual([]);
	});
});

describe("sign in", () => {
	it("signs in with the right password", async () => {
		const email = uniqueEmail();
		await signUp(email);

		const res = await signIn(email);
		expect(res.status).toBe(200);
		expect((await me(cookiesFrom(res))).status).toBe(200);
	});

	it("rejects the wrong password", async () => {
		const email = uniqueEmail();
		await signUp(email);

		const res = await signIn(email, "not the password");
		expect(res.status).toBe(401);
		expect(cookiesFrom(res)).toBe("");
	});

	it("rejects an unknown email the same way", async () => {
		const res = await signIn(uniqueEmail());
		expect(res.status).toBe(401);
	});

	it("rejects a sign in sent from another site", async () => {
		const email = uniqueEmail();
		await signUp(email);

		const res = await signIn(email, PASSWORD);
		const forged = await post(
			"/api/auth/sign-in/email",
			{ email, password: PASSWORD },
			{ origin: "https://evil.example" },
		);
		expect(res.status).toBe(200);
		expect(forged.status).toBe(403);
	});
});

describe("sessions", () => {
	it("refuses /api/me without a session", async () => {
		const res = await app.request("/api/me");
		expect(res.status).toBe(401);
	});

	it("ignores a sign out sent from another site", async () => {
		const cookie = cookiesFrom(await signUp());

		const res = await post(
			"/api/auth/sign-out",
			{},
			{ cookie, origin: "https://evil.example" },
		);
		expect(res.status).toBe(403);
		expect((await me(cookie)).status).toBe(200);
	});

	it("ends the session on sign out", async () => {
		const cookie = cookiesFrom(await signUp());
		expect((await me(cookie)).status).toBe(200);

		const res = await post("/api/auth/sign-out", {}, { cookie });
		expect(res.status).toBe(200);
		expect((await me(cookie)).status).toBe(401);
	});
});
