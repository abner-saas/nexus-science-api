import { fromNodeHeaders } from "better-auth/node";
import { desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { plans, students, users } from "../db/schema.js";
import { auth } from "../lib/better-auth.js";
import type { UserRole } from "../types/auth.js";

const planBody = z.object({
  name: z.string().min(2).max(80),
  tier: z.enum(["Bronze", "Silver", "Gold", "Custom"]).default("Custom"),
  value: z.string().regex(/^\d+(\.\d{1,2})?$/),
  benefits: z.array(z.string().max(120)).max(20).optional(),
  checkoutUrl: z.string().url().max(500).optional().nullable(),
  active: z.boolean().optional(),
});

const STAFF_ROLES: readonly UserRole[] = ["ADMIN", "TRAINER", "FINANCE", "RECEPTION"];

const leanPlanColumns = {
  id: plans.id,
  name: plans.name,
  tier: plans.tier,
  value: plans.value,
  benefits: plans.benefits,
  active: plans.active,
};

async function staffPlanList() {
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
}

async function activePlanList() {
  const rows = await db
    .select(leanPlanColumns)
    .from(plans)
    .where(eq(plans.active, true))
    .orderBy(desc(plans.createdAt));
  return { data: rows };
}

/**
 * GET /plans is the one authenticated route a lead (better-auth session, no
 * `users` row) may read. `fastify.authenticate` would 403 LEAD them — that
 * gate stays on every other route. Staff keeps the full CRM payload.
 */
async function resolvePlansAudience(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<"staff" | "catalog" | undefined> {
  const deny = (status: 401, message: string) => {
    reply.status(status).send({ error: "Unauthorized", message });
    return undefined;
  };

  try {
    await request.jwtVerify();
    const user = await db.query.users.findFirst({
      where: eq(users.id, request.user.sub),
      columns: { active: true, role: true },
    });
    if (!user?.active) return deny(401, "Usuário inativo ou inválido");
    return STAFF_ROLES.includes(user.role) ? "staff" : "catalog";
  } catch {
    /* sessão better-auth abaixo */
  }

  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    const email = session?.user?.email?.toLowerCase();
    if (!session?.user || !email) return deny(401, "Token inválido ou expirado");

    const row = await db.query.users.findFirst({
      where: sql`lower(${users.email}) = ${email}`,
      columns: { active: true, role: true },
    });
    if (!row) return "catalog";
    if (!row.active) return deny(401, "Usuário inativo ou inválido");
    return STAFF_ROLES.includes(row.role) ? "staff" : "catalog";
  } catch {
    return deny(401, "Token inválido ou expirado");
  }
}

export async function plansRoutes(fastify: FastifyInstance) {
  const writers = {
    preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "FINANCE"])],
  };

  fastify.get("/plans", async (request, reply) => {
    const audience = await resolvePlansAudience(request, reply);
    if (!audience) return;
    if (audience === "staff") return staffPlanList();
    return activePlanList();
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

  fastify.delete<{ Params: { id: string } }>(
    "/plans/:id",
    {
      preHandler: [fastify.authenticate, fastify.authorize(["ADMIN"])],
    },
    async (request, reply) => {
      if (!z.string().uuid().safeParse(request.params.id).success) {
        return reply.status(400).send({ error: "InvalidId" });
      }
      await db.delete(plans).where(eq(plans.id, request.params.id));
      return reply.status(204).send();
    },
  );
}
