import type { FastifyInstance } from "fastify";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { plans, students } from "../db/schema.js";

const planBody = z.object({
  name: z.string().min(2).max(80),
  tier: z.enum(["Bronze", "Silver", "Gold", "Custom"]).default("Custom"),
  value: z.string().regex(/^\d+(\.\d{1,2})?$/),
  benefits: z.array(z.string().max(120)).max(20).optional(),
  checkoutUrl: z.string().url().max(500).optional().nullable(),
  active: z.boolean().optional(),
});

export async function plansRoutes(fastify: FastifyInstance) {
  const staff = {
    preHandler: [
      fastify.authenticate,
      fastify.authorize(["ADMIN", "TRAINER", "FINANCE", "RECEPTION"]),
    ],
  };
  const writers = {
    preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "FINANCE"])],
  };

  fastify.get("/plans", staff, async () => {
    const rows = await db.select().from(plans).orderBy(desc(plans.createdAt));
    const counts = await db
      .select({
        planId: students.planId,
        count: sql<number>`count(*)::int`,
      })
      .from(students)
      .groupBy(students.planId);

    const countMap = new Map(counts.map((c) => [c.planId, c.count]));
    return {
      data: rows.map((p) => ({
        ...p,
        activeStudents: countMap.get(p.id) ?? 0,
      })),
    };
  });

  fastify.post("/plans", writers, async (request, reply) => {
    const parsed = planBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }
    const [row] = await db
      .insert(plans)
      .values({
        name: parsed.data.name,
        tier: parsed.data.tier,
        value: parsed.data.value,
        benefits: parsed.data.benefits ?? [],
        checkoutUrl: parsed.data.checkoutUrl ?? null,
        active: parsed.data.active ?? true,
      })
      .returning();
    return reply.status(201).send({ data: row });
  });

  fastify.patch<{ Params: { id: string } }>("/plans/:id", writers, async (request, reply) => {
    if (!z.string().uuid().safeParse(request.params.id).success) {
      return reply.status(400).send({ error: "InvalidId" });
    }
    const parsed = planBody.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }
    const [row] = await db
      .update(plans)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(plans.id, request.params.id))
      .returning();
    if (!row) return reply.status(404).send({ error: "NotFound" });
    return { data: row };
  });

  fastify.delete<{ Params: { id: string } }>("/plans/:id", {
    preHandler: [fastify.authenticate, fastify.authorize(["ADMIN"])],
  }, async (request, reply) => {
    if (!z.string().uuid().safeParse(request.params.id).success) {
      return reply.status(400).send({ error: "InvalidId" });
    }
    await db.delete(plans).where(eq(plans.id, request.params.id));
    return reply.status(204).send();
  });
}
