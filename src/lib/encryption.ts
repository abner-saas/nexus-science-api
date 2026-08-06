import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/** Encrypts sensitive fields at rest (LGPD health/medical notes). */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const key = Buffer.from(env.FIELD_ENCRYPTION_KEY, "hex");
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptField(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid encrypted payload");
  }
  const key = Buffer.from(env.FIELD_ENCRYPTION_KEY, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function maskSecret(value: string, visible = 4): string {
  if (value.length <= visible) return "****";
  return `${value.slice(0, visible)}****`;
}
