import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { and, eq, isNull, gt } from "drizzle-orm";
import { db } from "../db/index.js";
import { refreshTokens, users } from "../db/schema.js";
import type { JwtPayload } from "../types/auth.js";

const BCRYPT_ROUNDS = 12;

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateRefreshToken() {
  return randomBytes(48).toString("base64url");
}

export async function findUserByEmail(email: string) {
  return db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase().trim()),
  });
}

export async function persistRefreshToken(userId: string, token: string, expiresAt: Date) {
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });
}

export async function revokeRefreshToken(token: string) {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.tokenHash, hashToken(token)));
}

export async function revokeAllUserTokens(userId: string) {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

export async function validateRefreshToken(token: string) {
  const row = await db.query.refreshTokens.findFirst({
    where: and(
      eq(refreshTokens.tokenHash, hashToken(token)),
      isNull(refreshTokens.revokedAt),
      gt(refreshTokens.expiresAt, new Date()),
    ),
  });
  if (!row) return null;

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, row.userId), eq(users.active, true)),
  });
  return user ?? null;
}

export function toJwtPayload(user: {
  id: string;
  email: string;
  role: JwtPayload["role"];
  studentId: string | null;
}): JwtPayload {
  return {
    sub: user.id,
    email: user.email,
    role: user.role,
    studentId: user.studentId,
  };
}

export function refreshExpiryDate(expiresIn = "7d"): Date {
  const match = /^(\d+)([dhms])$/.exec(expiresIn);
  const now = Date.now();
  if (!match) return new Date(now + 7 * 24 * 60 * 60 * 1000);
  const amount = Number(match[1]);
  const unit = match[2];
  const mult =
    unit === "d" ? 86400000 : unit === "h" ? 3600000 : unit === "m" ? 60000 : 1000;
  return new Date(now + amount * mult);
}
