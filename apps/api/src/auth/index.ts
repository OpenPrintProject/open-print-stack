import { type Db, newId, schema } from "@ops/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { accountsPlugin } from "./accounts-plugin.ts";

/** ID prefixes for Better Auth's models, e.g. `usr_...`. */
const ID_PREFIXES: Record<string, string> = {
	tenant: "acc",
	user: "usr",
	session: "ses",
	account: "lgn",
	verification: "ver",
};

export type AuthOptions = {
	db: Db;
	/** Where people open the web app, e.g. http://localhost:5173. */
	baseURL: string;
	secret: string;
};

export function createAuth({ db, baseURL, secret }: AuthOptions) {
	return betterAuth({
		appName: "Open Print Stack",
		baseURL,
		secret,
		database: drizzleAdapter(db, {
			provider: "pg",
			transaction: true,
			schema: {
				tenant: schema.account,
				user: schema.user,
				session: schema.session,
				account: schema.authAccount,
				verification: schema.verification,
			},
		}),
		emailAndPassword: { enabled: true },
		plugins: [accountsPlugin()],
		advanced: {
			// Better Auth skips these checks when it detects a test run. Keep them
			// on everywhere, so tests cover them and production can't skip them.
			disableOriginCheck: false,
			disableCSRFCheck: false,
			database: {
				generateId: ({ model }) =>
					newId(ID_PREFIXES[model] ?? model.slice(0, 3)),
			},
		},
		telemetry: { enabled: false },
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth["$Infer"]["Session"];
