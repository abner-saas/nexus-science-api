/**
 * One-time data migration: mirrors every legacy e-mail/senha login
 * (`users.passwordHash`, bcrypt) into a better-auth credential
 * (`ba_user` + `ba_account`, provider `credential`), copying the bcrypt hash
 * verbatim.
 *
 * This does NOT reset anyone's password and does NOT need the plaintext
 * password. It relies on `src/lib/legacy-password.ts`'s custom
 * `emailAndPassword.password.verify` being bcrypt-aware: on an account's
 * first successful login after this backfill, that verify function detects
 * the bcrypt hash, validates it, and transparently rehashes to better-auth's
 * native scrypt format ("lazy migration") — so this script only needs to run
 * once, before (or as part of) the deploy that enables `emailAndPassword`.
 *
 * Idempotent — safe to re-run; already-migrated accounts (ba_user with a
 * `credential` ba_account already linked) are skipped.
 *
 * Usage: npx tsx scripts/backfill-ba-accounts.ts
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { isNotNull, sql } from "drizzle-orm";
import { baAccount, baUser } from "../src/db/auth-schema.js";
import { db } from "../src/db/index.js";
import { users } from "../src/db/schema.js";

async function main() {
  const legacyLogins = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(isNotNull(users.passwordHash));

  let created = 0;
  let linkedToExistingBaUser = 0;
  let alreadyMigrated = 0;

  for (const row of legacyLogins) {
    if (!row.passwordHash) continue;
    const email = row.email.toLowerCase().trim();
    const now = new Date();

    const existingBaUser = await db.query.baUser.findFirst({
      where: sql`lower(${baUser.email}) = ${email}`,
    });

    const userId = existingBaUser?.id ?? randomUUID();

    if (!existingBaUser) {
      await db.insert(baUser).values({
        id: userId,
        name: row.name,
        email,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    const existingAccount = await db.query.baAccount.findFirst({
      where: (fields) => sql`${fields.userId} = ${userId} and ${fields.providerId} = 'credential'`,
    });

    if (existingAccount) {
      alreadyMigrated += 1;
      continue;
    }

    await db.insert(baAccount).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: row.passwordHash,
      createdAt: now,
      updatedAt: now,
    });

    if (existingBaUser) {
      linkedToExistingBaUser += 1;
    } else {
      created += 1;
    }
    console.log(`Migrado: ${email}`);
  }

  console.log("—");
  console.log(`Total de logins legados encontrados: ${legacyLogins.length}`);
  console.log(`Novos ba_user + ba_account criados: ${created}`);
  console.log(
    `Credencial adicionada a ba_user já existente (ex.: Google): ${linkedToExistingBaUser}`,
  );
  console.log(`Já migrados (ignorados): ${alreadyMigrated}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
