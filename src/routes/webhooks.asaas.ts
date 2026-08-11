import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { payments, students } from "../db/schema.js";
import { env } from "../lib/env.js";

/** Constant-time token comparison — a plain `!==` leaks match-length via response timing. */
function safeTokenEquals(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const asaasEvent = z.object({
  event: z.string(),
  payment: z
    .object({
      id: z.string(),
      status: z.string().optional(),
      customer: z.string().optional(),
      value: z.number().optional(),
      externalReference: z.string().optional(),
    })
    .optional(),
});

/**
 * Asaas webhooks — validate shared token header (never trust bare IP alone).
 * Header: asaas-access-token or x-asaas-token
 */
export async function asaasWebhookRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/webhooks/asaas",
    {
      config: {
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const token =
        (request.headers["asaas-access-token"] as string | undefined) ||
        (request.headers["x-asaas-token"] as string | undefined);

      if (!env.ASAAS_WEBHOOK_TOKEN || !safeTokenEquals(token, env.ASAAS_WEBHOOK_TOKEN)) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const parsed = asaasEvent.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "ValidationError" });
      }

      const { event, payment } = parsed.data;
      if (!payment?.id) {
        return reply.status(200).send({ ok: true, ignored: true });
      }

      const existing = await db.query.payments.findFirst({
        where: eq(payments.asaasPaymentId, payment.id),
      });

      if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
        if (existing) {
          await db
            .update(payments)
            .set({ status: "CONFIRMED", paidAt: new Date(), updatedAt: new Date() })
            .where(eq(payments.id, existing.id));

          await db
            .update(students)
            .set({ status: "Ativo", appAccess: true, updatedAt: new Date() })
            .where(eq(students.id, existing.studentId));
        }
      }

      if (event === "PAYMENT_OVERDUE") {
        if (existing) {
          await db
            .update(payments)
            .set({ status: "OVERDUE", updatedAt: new Date() })
            .where(eq(payments.id, existing.id));

          await db
            .update(students)
            .set({ status: "Inadimplente", appAccess: false, updatedAt: new Date() })
            .where(eq(students.id, existing.studentId));
        }
      }

      return { ok: true };
    },
  );
}
