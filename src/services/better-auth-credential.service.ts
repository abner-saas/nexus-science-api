import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { baAccount, baUser } from "../db/auth-schema.js";
import { db } from "../db/index.js";
import { hashPassword } from "../lib/legacy-password.js";

/**
 * Creates or updates the better-auth credential mirror (`ba_user` + `ba_account`,
 * provider `credential`) for an app-managed e-mail/senha login.
 *
 * After the better-auth migration, `/auth/login` and the native
 * `/api/auth/sign-in/email` (used by the future mobile app) are the only way
 * to authenticate — a `users.passwordHash` row alone is no longer enough.
 * Every place that creates/resets an app login (`POST /users`,
 * `PATCH /users/:id`, `POST /users/student-access`, `db:seed`) must also call
 * this so the account can actually log in. `users.passwordHash` keeps being
 * written by those callers for continuity/rollback, but it's otherwise unused
 * once this credential exists.
 *
 * Inserts/updates `ba_user`/`ba_account` directly via Drizzle (not through
 * `auth.api.signUpEmail`) because these accounts are admin-provisioned, not
 * self-service — there's no better-auth request/session context here, and we
 * don't want `databaseHooks.user.create.after` (which links Google/self-signup
 * leads to `students`) to run for them: the caller already created/owns the
 * app `users` row with the right role/studentId.
 */
export async function upsertBetterAuthCredential(params: {
  email: string;
  name: string;
  password: string;
}): Promise<void> {
  const email = params.email.toLowerCase().trim();
  const passwordHash = await hashPassword(params.password);
  const now = new Date();

  const existingBaUser = await db.query.baUser.findFirst({
    where: sql`lower(${baUser.email}) = ${email}`,
  });

  const userId = existingBaUser?.id ?? randomUUID();

  if (!existingBaUser) {
    await db.insert(baUser).values({
      id: userId,
      name: params.name,
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
  } else if (existingBaUser.name !== params.name) {
    await db.update(baUser).set({ name: params.name, updatedAt: now }).where(eq(baUser.id, userId));
  }

  const existingAccount = await db.query.baAccount.findFirst({
    where: (fields) => sql`${fields.userId} = ${userId} and ${fields.providerId} = 'credential'`,
  });

  if (existingAccount) {
    await db
      .update(baAccount)
      .set({ password: passwordHash, updatedAt: now })
      .where(eq(baAccount.id, existingAccount.id));
  } else {
    await db.insert(baAccount).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
  }
}
