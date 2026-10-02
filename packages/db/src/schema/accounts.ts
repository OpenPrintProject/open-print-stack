import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The customer: every other record belongs to one account.
 * Created together with its owner when someone signs up.
 */
export const account = pgTable("account", {
	id: text().primaryKey(),
	createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});
