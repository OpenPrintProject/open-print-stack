import { createAuthClient } from "better-auth/react";

/** Talks to Better Auth on the API, which the dev server proxies at /api. */
export const authClient = createAuthClient({ basePath: "/api/auth" });
