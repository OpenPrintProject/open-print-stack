import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { account } from "./accounts.ts";

// Tables used by Better Auth (apps/api/src/auth). Column names follow its core
// schema; its own "account" table (sign-in methods) is called authAccount here,
// so "account" can mean the customer, as in the data model.

/** A login. Each user belongs to exactly one account. */
export const user = pgTable(
	"user",
	{
		id: text().primaryKey(),
		accountId: text()
			.notNull()
			.references(() => account.id),
		name: text().notNull(),
		email: text().notNull().unique(),
		emailVerified: boolean().default(false).notNull(),
		image: text(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index().on(table.accountId)],
);

export const session = pgTable(
	"session",
	{
		id: text().primaryKey(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		token: text().notNull().unique(),
		expiresAt: timestamp({ withTimezone: true }).notNull(),
		ipAddress: text(),
		userAgent: text(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index().on(table.userId)],
);

/** A way for a user to sign in: a password, or later a linked OAuth provider. */
export const authAccount = pgTable(
	"auth_account",
	{
		id: text().primaryKey(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accountId: text().notNull(),
		providerId: text().notNull(),
		accessToken: text(),
		refreshToken: text(),
		idToken: text(),
		accessTokenExpiresAt: timestamp({ withTimezone: true }),
		refreshTokenExpiresAt: timestamp({ withTimezone: true }),
		scope: text(),
		password: text(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index().on(table.userId)],
);

export const verification = pgTable(
	"verification",
	{
		id: text().primaryKey(),
		identifier: text().notNull(),
		value: text().notNull(),
		expiresAt: timestamp({ withTimezone: true }).notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index().on(table.identifier)],
);
