import { createMiddleware } from "hono/factory";
import type { Auth, AuthSession } from "./index.ts";

export type SessionEnv = {
	Variables: {
		user: AuthSession["user"];
		session: AuthSession["session"];
		/** The account the signed-in user belongs to. Scope every query by it. */
		accountId: string;
	};
};

/** Rejects the request with 401 unless it carries a valid session. */
export function requireSession(auth: Auth) {
	return createMiddleware<SessionEnv>(async (c, next) => {
		const result = await auth.api.getSession({ headers: c.req.raw.headers });
		if (!result) return c.json({ error: "unauthorized" }, 401);

		const { accountId } = result.user;
		if (!accountId) throw new Error(`User ${result.user.id} has no account`);

		c.set("user", result.user);
		c.set("session", result.session);
		c.set("accountId", accountId);
		await next();
	});
}
