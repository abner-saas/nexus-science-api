import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/index.js";
import { baAccount, baSession, baUser, baVerification } from "../db/auth-schema.js";
import { env } from "./env.js";
import { ensureAppUserFromOAuth } from "../services/oauth-user.service.js";

const origins = env.CORS_ORIGIN.split(",").map((o) => o.trim());

export const auth = betterAuth({
  appName: "Nexus Science",
  baseURL: env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`,
  secret: env.BETTER_AUTH_SECRET ?? env.JWT_ACCESS_SECRET,
  trustedOrigins: origins,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: baUser,
      session: baSession,
      account: baAccount,
      verification: baVerification,
    },
  }),
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
      allowDifferentEmails: false,
    },
  },
  socialProviders: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          prompt: "select_account",
        },
      }
    : {},
  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: env.COOKIE_SAME_SITE,
      path: "/",
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await ensureAppUserFromOAuth({
            email: user.email,
            name: user.name,
          });
        },
      },
    },
  },
});

export function googleAuthEnabled() {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
