import { Hono } from "hono";
import type { Auth } from "./auth/index.ts";
import { requireSession } from "./auth/session.ts";

export type AppOptions = {
	auth: Auth;
};

export function createApp({ auth }: AppOptions) {
	const app = new Hono().basePath("/api");

	app.get("/health", (c) => c.json({ ok: true }));

	// Sign up, sign in, sign out and sessions: see https://www.better-auth.com/docs
	app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));

	app.get("/me", requireSession(auth), (c) => {
		const user = c.get("user");
		return c.json({
			user: { id: user.id, name: user.name, email: user.email },
			accountId: c.get("accountId"),
		});
	});

	return app;
}

export type App = ReturnType<typeof createApp>;
