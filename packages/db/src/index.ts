import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as runMigrations } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema/index.ts";

const migrationsFolder = fileURLToPath(
	new URL("../migrations", import.meta.url),
);

export function createDb(url: string) {
	const client = postgres(url);
	return drizzle(client, { schema, casing: "snake_case" });
}

export type Db = ReturnType<typeof createDb>;

/** Brings the database up to date with the migrations in packages/db/migrations. */
export async function migrate(db: Db): Promise<void> {
	await runMigrations(db, { migrationsFolder });
}

export { newId } from "./ids.ts";
export { schema };
