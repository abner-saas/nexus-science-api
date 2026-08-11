import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().default(3333),
    HOST: z.string().default("0.0.0.0"),
    DATABASE_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(64),
    JWT_REFRESH_SECRET: z.string().min(64),
    JWT_ACCESS_EXPIRES: z.string().default("15m"),
    JWT_REFRESH_EXPIRES: z.string().default("7d"),
    FIELD_ENCRYPTION_KEY: z.string().length(64),
    CORS_ORIGIN: z.string().min(1),
    COOKIE_DOMAIN: z.string().default("localhost"),
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    // "none" is required when the frontend and API are on different root domains
    // (cross-site requests) — browsers refuse SameSite=None without Secure=true.
    COOKIE_SAME_SITE: z.enum(["strict", "lax", "none"]).default("strict"),
    ASAAS_API_KEY: z.string().optional(),
    ASAAS_WEBHOOK_TOKEN: z.string().optional(),
    ASAAS_BASE_URL: z.string().default("https://sandbox.asaas.com/api/v3"),
    AI_PROVIDER: z.enum(["openai", "gemini"]).default("openai"),
    OPENAI_API_KEY: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    SEED_ADMIN_EMAIL: z.string().email().optional(),
    SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
    SEED_ADMIN_NAME: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.COOKIE_SAME_SITE === "none" && !data.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "COOKIE_SECURE must be true when COOKIE_SAME_SITE=none (required by browsers)",
        path: ["COOKIE_SECURE"],
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
