import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { transactions, students, payments } from "../db/schema.js";

const txBody = z.object({
  type: z.enum(["RECEITA", "DESPESA"]),
  category: z.string().min(1).max(80),
  description: z.string().max(255).optional().nullable(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  studentId: z.string().uuid().optional().nullable(),
});

export async function financeRoutes(fastify: FastifyInstance) {
  const readers = {
    preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "FINANCE"])],
  };
  const writers = {
    preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "FINANCE"])],
  };

  fastify.get("/finance/summary", readers, async (request) => {
    const q = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .safeParse(request.query);

    const from = q.success ? q.data.from : undefined;
    const to = q.success ? q.data.to : undefined;

    const filters = [];
    if (from) filters.push(gte(transactions.date, from));
    if (to) filters.push(lte(transactions.date, to));
    const where = filters.length ? and(...filters) : undefined;

    const [agg] = await db
      .select({
        revenue: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'RECEITA'), 0)`,
        expenses: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'DESPESA'), 0)`,
      })
      .from(transactions)
      .where(where);

    const revenue = Number(agg?.revenue ?? 0);
    const expenses = Number(agg?.expenses ?? 0);
    const profit = revenue - expenses;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

    const [mrrRow] = await db
      .select({
        mrr: sql<string>`coalesce(sum(${students.value}) filter (where ${students.status} = 'Ativo'), 0)`,
      })
      .from(students);

    const byPlan = await db
      .select({
        planId: students.planId,
        revenue: sql<string>`coalesce(sum(${students.value}) filter (where ${students.status} = 'Ativo'), 0)`,
        count: sql<number>`count(*) filter (where ${students.status} = 'Ativo')::int`,
      })
      .from(students)
      .groupBy(students.planId);

    const series = await db
      .select({
        month: sql<string>`to_char(${transactions.date}::date, 'YYYY-MM')`,
        revenue: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'RECEITA'), 0)`,
        expenses: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'DESPESA'), 0)`,
      })
      .from(transactions)
      .where(where)
      .groupBy(sql`to_char(${transactions.date}::date, 'YYYY-MM')`)
      .orderBy(sql`to_char(${transactions.date}::date, 'YYYY-MM')`);

    return {
      data: {
        revenue,
        expenses,
        profit,
        margin: +margin.toFixed(1),
        mrr: Number(mrrRow?.mrr ?? 0),
        arr: Number(mrrRow?.mrr ?? 0) * 12,
        byPlan,
        series: series.map((s) => ({
          month: s.month,
          revenue: Number(s.revenue),
          expenses: Number(s.expenses),
          profit: Number(s.revenue) - Number(s.expenses),
        })),
      },
    };
  });

  fastify.get("/finance/transactions", readers, async (request) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        type: z.enum(["RECEITA", "DESPESA"]).optional(),
      })
      .safeParse(request.query);

    const rows = await db
      .select()
      .from(transactions)
      .where(
        q.success && q.data.type ? eq(transactions.type, q.data.type) : undefined,
      )
      .orderBy(desc(transactions.date))
      .limit(q.success ? q.data.limit ?? 50 : 50);

    return { data: rows };
  });

  fastify.post("/finance/transactions", writers, async (request, reply) => {
    const parsed = txBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }
    const [row] = await db
      .insert(transactions)
      .values({
        type: parsed.data.type,
        category: parsed.data.category,
        description: parsed.data.description ?? null,
        amount: parsed.data.amount,
        date: parsed.data.date,
        studentId: parsed.data.studentId ?? null,
        createdBy: request.user.sub,
      })
      .returning();
    return reply.status(201).send({ data: row });
  });

  fastify.get("/payments", {
    preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "FINANCE", "STUDENT"])],
  }, async (request) => {
    const q = z.object({ studentId: z.string().uuid().optional() }).safeParse(request.query);
    const studentId =
      request.user.role === "STUDENT"
        ? request.user.studentId ?? undefined
        : q.success
          ? q.data.studentId
          : undefined;

    const rows = await db
      .select()
      .from(payments)
      .where(studentId ? eq(payments.studentId, studentId) : undefined)
      .orderBy(desc(payments.dueDate))
      .limit(100);

    return { data: rows };
  });

  fastify.post("/payments", {
    preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "FINANCE"])],
  }, async (request, reply) => {
    const body = z
      .object({
        studentId: z.string().uuid(),
        amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
        method: z.enum(["PIX", "CREDIT_CARD", "BOLETO"]).optional(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        checkoutUrl: z.string().url().optional().nullable(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "ValidationError", issues: body.error.flatten() });
    }
    const [row] = await db
      .insert(payments)
      .values({
        studentId: body.data.studentId,
        amount: body.data.amount,
        method: body.data.method,
        dueDate: body.data.dueDate,
        checkoutUrl: body.data.checkoutUrl ?? null,
        status: "PENDING",
      })
      .returning();
    return reply.status(201).send({ data: row });
  });
}
