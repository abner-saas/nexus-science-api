import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { payments, students, transactions } from "../db/schema.js";
import { todayInRecife } from "../domain/billing-status.js";
import { FINANCE_PERIODS, resolveFinancePeriod } from "../domain/finance-period.js";
import {
  createCategory,
  deleteCategory,
  listCategories,
  suggestCategory,
  updateCategory,
} from "../services/finance-category.service.js";

const txBody = z.object({
  type: z.enum(["RECEITA", "DESPESA"]),
  category: z.string().max(80).optional().nullable(),
  description: z.string().max(255).optional().nullable(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  studentId: z.string().uuid().optional().nullable(),
  method: z.enum(["PIX", "CREDIT_CARD", "BOLETO"]).optional().nullable(),
});

const categoryBody = z.object({
  name: z.string().min(2).max(80),
  type: z.enum(["RECEITA", "DESPESA"]),
  matchTerms: z.string().max(500).optional(),
});

export async function financeRoutes(fastify: FastifyInstance) {
  const readers = {
    preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "FINANCE"])],
  };
  const writers = {
    preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "FINANCE"])],
  };

  fastify.get("/finance/summary", readers, async (request, reply) => {
    const q = z
      .object({
        period: z.enum(FINANCE_PERIODS).optional(),
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .safeParse(request.query);

    if (!q.success) {
      return reply.status(400).send({ error: "ValidationError", issues: q.error.flatten() });
    }

    let from = q.data.from;
    let to = q.data.to;
    if (q.data.period) {
      const range = resolveFinancePeriod(q.data.period, todayInRecife(), { from, to });
      if ("error" in range) {
        return reply.status(400).send({ error: "ValidationError", message: "Período inválido" });
      }
      from = range.from;
      to = range.to;
    }

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

    const byCategory = await db
      .select({
        category: transactions.category,
        type: transactions.type,
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .where(where)
      .groupBy(transactions.category, transactions.type);

    const [overdue] = await db
      .select({
        amount: sql<string>`coalesce(sum(${students.value}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(students)
      .where(eq(students.status, "Inadimplente"));

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
        from: from ?? null,
        to: to ?? null,
        revenue,
        expenses,
        profit,
        margin: +margin.toFixed(1),
        mrr: Number(mrrRow?.mrr ?? 0),
        arr: Number(mrrRow?.mrr ?? 0) * 12,
        overdueAmount: Number(overdue?.amount ?? 0),
        overdueCount: overdue?.count ?? 0,
        byPlan,
        revenueByCategory: byCategory
          .filter((c) => c.type === "RECEITA")
          .map((c) => ({ category: c.category, total: Number(c.total) })),
        expenseByCategory: byCategory
          .filter((c) => c.type === "DESPESA")
          .map((c) => ({ category: c.category, total: Number(c.total) })),
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
      .where(q.success && q.data.type ? eq(transactions.type, q.data.type) : undefined)
      .orderBy(desc(transactions.date))
      .limit(q.success ? (q.data.limit ?? 50) : 50);

    return { data: rows };
  });

  fastify.post("/finance/transactions", writers, async (request, reply) => {
    const parsed = txBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }
    const category = await resolveTxCategory(parsed.data);
    if (!category) {
      return reply.status(400).send({
        error: "ValidationError",
        message: "Informe a categoria ou uma descrição reconhecida por uma categoria.",
      });
    }
    const [row] = await db
      .insert(transactions)
      .values({
        type: parsed.data.type,
        category,
        description: parsed.data.description ?? null,
        amount: parsed.data.amount,
        date: parsed.data.date,
        studentId: parsed.data.studentId ?? null,
        method: parsed.data.method ?? null,
        createdBy: request.user.sub,
      })
      .returning();
    return reply.status(201).send({ data: row });
  });

  fastify.patch<{ Params: { id: string } }>(
    "/finance/transactions/:id",
    writers,
    async (request, reply) => {
      if (!z.string().uuid().safeParse(request.params.id).success) {
        return reply.status(400).send({ error: "InvalidId" });
      }
      const parsed = txBody.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
      }
      const current = await db.query.transactions.findFirst({
        where: eq(transactions.id, request.params.id),
      });
      if (!current) return reply.status(404).send({ error: "NotFound" });

      const type = parsed.data.type ?? current.type;
      const description =
        parsed.data.description !== undefined ? parsed.data.description : current.description;
      let category = parsed.data.category?.trim() || current.category;
      if (!parsed.data.category?.trim() && parsed.data.description) {
        category = (await suggestCategory(parsed.data.description, type)) ?? category;
      }
      const [row] = await db
        .update(transactions)
        .set({
          type,
          category,
          description: description ?? null,
          ...(parsed.data.amount !== undefined ? { amount: parsed.data.amount } : {}),
          ...(parsed.data.date !== undefined ? { date: parsed.data.date } : {}),
          ...(parsed.data.studentId !== undefined ? { studentId: parsed.data.studentId } : {}),
          ...(parsed.data.method !== undefined ? { method: parsed.data.method } : {}),
        })
        .where(eq(transactions.id, request.params.id))
        .returning();
      return { data: row };
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    "/finance/transactions/:id",
    writers,
    async (request, reply) => {
      if (!z.string().uuid().safeParse(request.params.id).success) {
        return reply.status(400).send({ error: "InvalidId" });
      }
      const [row] = await db
        .delete(transactions)
        .where(eq(transactions.id, request.params.id))
        .returning({ id: transactions.id });
      if (!row) return reply.status(404).send({ error: "NotFound" });
      return reply.status(204).send();
    },
  );

  fastify.get("/finance/categories", readers, async () => {
    return { data: await listCategories() };
  });

  fastify.get("/finance/category-match", readers, async (request) => {
    const q = z
      .object({
        type: z.enum(["RECEITA", "DESPESA"]),
        description: z.string().max(255).optional().default(""),
      })
      .safeParse(request.query);
    if (!q.success) return { data: { category: null } };
    return { data: { category: await suggestCategory(q.data.description, q.data.type) } };
  });

  fastify.post("/finance/categories", writers, async (request, reply) => {
    const parsed = categoryBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }
    try {
      const row = await createCategory({
        name: parsed.data.name,
        type: parsed.data.type,
        matchTerms: parsed.data.matchTerms ?? "",
      });
      return reply.status(201).send({ data: row });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return reply.status(409).send({ error: "Conflict", message: "Categoria já existe" });
    }
  });

  fastify.patch<{ Params: { id: string } }>(
    "/finance/categories/:id",
    writers,
    async (request, reply) => {
      if (!z.string().uuid().safeParse(request.params.id).success) {
        return reply.status(400).send({ error: "InvalidId" });
      }
      const parsed = categoryBody.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
      }
      const row = await updateCategory(request.params.id, parsed.data);
      if (!row) return reply.status(404).send({ error: "NotFound" });
      return { data: row };
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    "/finance/categories/:id",
    writers,
    async (request, reply) => {
      if (!z.string().uuid().safeParse(request.params.id).success) {
        return reply.status(400).send({ error: "InvalidId" });
      }
      const removed = await deleteCategory(request.params.id);
      if (!removed) return reply.status(404).send({ error: "NotFound" });
      return reply.status(204).send();
    },
  );

  fastify.get(
    "/payments",
    {
      preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "FINANCE", "STUDENT"])],
    },
    async (request) => {
      const q = z.object({ studentId: z.string().uuid().optional() }).safeParse(request.query);
      const studentId =
        request.user.role === "STUDENT"
          ? (request.user.studentId ?? undefined)
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
    },
  );

  fastify.post(
    "/payments",
    {
      preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "FINANCE"])],
    },
    async (request, reply) => {
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
    },
  );
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "23505") return true;
  if ("cause" in error) return isUniqueViolation(error.cause);
  return false;
}

async function resolveTxCategory(input: {
  type: "RECEITA" | "DESPESA";
  category?: string | null;
  description?: string | null;
}): Promise<string | null> {
  const explicit = input.category?.trim();
  if (explicit) return explicit;
  if (!input.description?.trim()) return null;
  return suggestCategory(input.description, input.type);
}
