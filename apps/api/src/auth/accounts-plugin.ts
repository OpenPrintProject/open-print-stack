import { type BetterAuthPlugin, getCurrentAdapter } from "better-auth";

/**
 * Gives every new user their own account, created in the same transaction as
 * the user, so there's never a user without an account or an account without
 * its owner.
 *
 * Better Auth already has a model called "account" (sign-in methods), so the
 * customer account is the "tenant" model here. Both map to Drizzle tables in
 * auth/index.ts.
 */
export function accountsPlugin() {
	return {
		id: "accounts",
		schema: {
			tenant: {
				fields: {
					createdAt: {
						type: "date",
						required: true,
						input: false,
						defaultValue: () => new Date(),
					},
				},
			},
			user: {
				fields: {
					// Not required here because the hook below fills it in; the column
					// itself is NOT NULL.
					accountId: {
						type: "string",
						required: false,
						input: false,
						references: { model: "tenant", field: "id" },
					},
				},
			},
		},
		init(ctx) {
			return {
				options: {
					databaseHooks: {
						user: {
							create: {
								async before(user) {
									// Inside sign-up's transaction, this is the transaction's adapter.
									const adapter = await getCurrentAdapter(ctx.adapter);
									const tenant = await adapter.create<
										{ createdAt: Date },
										{ id: string }
									>({
										model: "tenant",
										data: { createdAt: new Date() },
									});
									return { data: { ...user, accountId: tenant.id } };
								},
							},
						},
					},
				},
			};
		},
	} satisfies BetterAuthPlugin;
}
