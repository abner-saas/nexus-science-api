import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { baAccount, baSession, baUser, baVerification } from "../db/auth-schema.js";
import { db } from "../db/index.js";
import { ensureAppUserFromOAuth } from "../services/oauth-user.service.js";
import { env } from "./env.js";
import { hashPassword, verifyPassword } from "./legacy-password.js";
import { mobileTrustedOrigins } from "./mobile-origins.js";

const origins = env.CORS_ORIGIN.split(",").map((o) => o.trim());

export const auth = betterAuth({
  appName: "Nexus Science",
  baseURL: env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`,
  secret: env.BETTER_AUTH_SECRET ?? env.JWT_ACCESS_SECRET,
  // Web origins from CORS_ORIGIN, plus the Expo scheme. The expo() plugin
  // also appends `exp://` when NODE_ENV=development. Do not use "*".
  trustedOrigins: [...origins, ...mobileTrustedOrigins(env.NODE_ENV)],
  plugins: [expo()],
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
  // Migrated from the old custom-JWT e-mail/senha system (`src/routes/auth.ts`
  // used to do its own bcrypt + @fastify/jwt dance) so there's a single auth
  // system covering e-mail/senha and Google — required for the mobile app's
  // `@better-auth/expo` plugin, which only understands better-auth sessions.
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    // No transactional e-mail sender exists yet — don't introduce a hard
    // requirement for a flow that isn't built. Future improvement: configure
    // `emailVerification.sendVerificationEmail` and flip this on.
    requireEmailVerification: false,
    // Legacy-aware hash/verify: existing `users.passwordHash` (bcrypt) rows are
    // mirrored into `ba_account.password` as-is by `scripts/backfill-ba-accounts.ts`;
    // `verifyPassword` detects the bcrypt format and lazily rehashes to
    // better-auth's native scrypt format on first successful login. See
    // `src/lib/legacy-password.ts` for the full rationale.
    password: {
      hash: hashPassword,
      verify: verifyPassword,
    },
  },
  socialProviders:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
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
