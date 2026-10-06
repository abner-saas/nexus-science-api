import bcrypt from "bcrypt";
import { hashPassword as hashScrypt, verifyPassword as verifyScrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { baAccount } from "../db/auth-schema.js";
import { db } from "../db/index.js";

const BCRYPT_HASH_PATTERN = /^\$2[aby]?\$/;

export function isBcryptHash(hash: string): boolean {
  return BCRYPT_HASH_PATTERN.test(hash);
}

/**
 * Password hasher/verifier plugged into better-auth's `emailAndPassword.password`
 * option (see `src/lib/better-auth.ts`).
 *
 * Context: before this migration, e-mail/senha login had its own bcrypt-based
 * system (`src/services/auth.service.ts`, `users.passwordHash`), separate from
 * better-auth's Google OAuth sessions. Better-auth hashes new passwords with
 * scrypt by default (`ba_account.password`) — an incompatible format, so legacy
 * bcrypt hashes can't just be copied over verbatim and verified as-is by the
 * stock verifier.
 *
 * Strategy ("lazy migration", see `scripts/backfill-ba-accounts.ts`): a one-time
 * backfill copies each legacy bcrypt hash as-is into `ba_account.password`. This
 * `verifyPassword` below detects the bcrypt format by its `$2a$`/`$2b$`/`$2y$`
 * prefix and verifies it with bcrypt; on success, it transparently rehashes the
 * password to better-auth's scrypt format and persists it — so every legacy
 * account ends up fully migrated the first time its owner logs in, with no
 * forced password reset. Accounts that are already scrypt (new signups, or
 * already-migrated legacy accounts) go through better-auth's stock verifier.
 *
 * Limitation: better-auth's `password.verify` callback only receives
 * `{ hash, password }` — not the account/user id — so the lazy-rehash update
 * below has to match the account by its current (unique, salted) hash value.
 * Collision risk is the same as a bcrypt hash collision, i.e. negligible.
 */
export async function hashPassword(password: string): Promise<string> {
  return hashScrypt(password);
}

export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  if (!isBcryptHash(hash)) {
    return verifyScrypt({ hash, password });
  }

  const legacyOk = await bcrypt.compare(password, hash);
  if (!legacyOk) return false;

  try {
    const upgraded = await hashScrypt(password);
    await db
      .update(baAccount)
      .set({ password: upgraded, updatedAt: new Date() })
      .where(eq(baAccount.password, hash));
  } catch {
    // Best-effort — login still succeeds on the legacy hash; the rehash is
    // simply retried on the next successful login if this write failed.
  }
  return true;
}
