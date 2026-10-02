import { createDb, migrate } from "@ops/db";
import postgres from "postgres";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		databaseUrl: string;
	}
}

/**
 * Creates an empty test database next to the dev one and migrates it.
 * Needs Postgres running: `pnpm db:up`.
 */
export default async function setup(project: TestProject) {
	const adminUrl =
		process.env.DATABASE_URL ?? "postgres://ops:ops@localhost:5432/ops";
	const url = new URL(adminUrl);
	const name = `${url.pathname.slice(1)}_test`;
	url.pathname = `/${name}`;

	const admin = postgres(adminUrl, { onnotice: () => {} });
	try {
		await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
		await admin.unsafe(`CREATE DATABASE "${name}"`);
	} finally {
		await admin.end();
	}

	const db = createDb(url.toString());
	try {
		await migrate(db);
	} finally {
		await db.$client.end();
	}

	project.provide("databaseUrl", url.toString());
}
