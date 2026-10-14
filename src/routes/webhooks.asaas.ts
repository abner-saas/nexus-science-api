import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { payments, students, transactions } from "../db/schema.js";
import { env } from "../lib/env.js";
import { syncStudentBilling } from "../services/billing.service.js";
import { listUserIdsForPush, notifyUsers } from "../services/push-notification.service.js";
import type { UserRole } from "../types/auth.js";

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

      // Checkout grava o id devolvido por POST /v3/payments. externalReference
      // leva o id local, mas o match continua sendo só por asaasPaymentId.
      const existing = await db.query.payments.findFirst({
        where: eq(payments.asaasPaymentId, payment.id),
      });

      if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
        if (existing) {
          await db
            .update(payments)
            .set({ status: "CONFIRMED", paidAt: new Date(), updatedAt: new Date() })
            .where(eq(payments.id, existing.id));

          await syncStudentBilling(existing.studentId);

          const alreadyBooked = await db
            .select({ id: transactions.id })
            .from(transactions)
            .where(eq(transactions.paymentId, existing.id))
            .limit(1);
          if (alreadyBooked.length === 0) {
            await db.insert(transactions).values({
              type: "RECEITA",
              category: "Mensalidades",
              description: `Pagamento confirmado (${existing.method ?? "Asaas"})`,
              amount: existing.amount,
              date: new Date().toISOString().slice(0, 10),
              studentId: existing.studentId,
              paymentId: existing.id,
              method: existing.method,
            });
          }

          await notifyPayment(request.log, existing.studentId, ["ADMIN", "RECEPTION"], {
            title: "Pagamento confirmado",
            body: (nome) => `Pagamento de ${nome} foi confirmado.`,
          });
        }
      }

      if (event === "PAYMENT_OVERDUE") {
        if (existing) {
          await db
            .update(payments)
            .set({ status: "OVERDUE", updatedAt: new Date() })
            .where(eq(payments.id, existing.id));

          await syncStudentBilling(existing.studentId);

          await notifyPayment(request.log, existing.studentId, ["ADMIN", "FINANCE"], {
            title: "Pagamento em atraso",
            body: (nome) => `Cobrança de ${nome} está vencida.`,
          });
        }
      }

      return { ok: true };
    },
  );
}

/** Best-effort: falha de push não pode falhar o webhook. */
async function notifyPayment(
  log: FastifyBaseLogger,
  studentId: string,
  roles: readonly UserRole[],
  payload: { title: string; body: (studentName: string) => string },
) {
  try {
    const [student] = await db
      .select({ name: students.name })
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);
    const nome = student?.name?.trim() || "aluno";
    const userIds = await listUserIdsForPush({ roles, studentId });
    await notifyUsers(userIds, { title: payload.title, body: payload.body(nome) }, log);
  } catch (err) {
    log.error({ err }, "Falha ao disparar push de pagamento");
  }
}
