import { z } from "zod";

const configSchema = z.object({
	DATABASE_URL: z.url(),
	API_PORT: z.coerce.number().int().positive().default(3000),
	/** Where people open the web app. The API is served under /api on the same origin. */
	APP_URL: z.url().default("http://localhost:5173"),
	/** Signs sessions. Generate one with `openssl rand -base64 32`. */
	BETTER_AUTH_SECRET: z.string().min(32),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const result = configSchema.safeParse(env);
	if (!result.success) {
		throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
	}
	return result.data;
}
