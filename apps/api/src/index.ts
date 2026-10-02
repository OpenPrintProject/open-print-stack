import { serve } from "@hono/node-server";
import { createDb } from "@ops/db";
import { createApp } from "./app.ts";
import { createAuth } from "./auth/index.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const auth = createAuth({
	db,
	baseURL: config.APP_URL,
	secret: config.BETTER_AUTH_SECRET,
});
const app = createApp({ auth });

serve({ fetch: app.fetch, port: config.API_PORT }, (info) => {
	console.log(`API listening on http://localhost:${info.port}/api`);
});
