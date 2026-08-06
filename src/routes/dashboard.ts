import type { FastifyInstance } from "fastify";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { dailyMetrics, students } from "../db/schema.js";

export async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/dashboard/summary",
    {
      preHandler: [
        fastify.authenticate,
        fastify.authorize(["ADMIN", "FINANCE", "TRAINER"]),
      ],
    },
    async () => {
      const latest = await db.query.dailyMetrics.findFirst({
        orderBy: [desc(dailyMetrics.date)],
      });

      const [counts] = await db
        .select({
          active: sql<number>`count(*) filter (where ${students.status} = 'Ativo')::int`,
          overdue: sql<number>`count(*) filter (where ${students.status} = 'Inadimplente')::int`,
          paused: sql<number>`count(*) filter (where ${students.status} = 'Pausado')::int`,
          cancelled: sql<number>`count(*) filter (where ${students.status} = 'Cancelado')::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(students);

      return {
        data: {
          metrics: latest ?? null,
          students: counts,
          note: latest
            ? "KPIs de daily_metrics (atualizados periodicamente)"
            : "Sem métricas agregadas ainda — use CRM para popular dados",
        },
      };
    },
  );

  fastify.post(
    "/dashboard/recompute",
    {
      preHandler: [fastify.authenticate, fastify.authorize(["ADMIN"])],
    },
    async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [agg] = await db
        .select({
          active: sql<number>`count(*) filter (where ${students.status} = 'Ativo')::int`,
          overdue: sql<number>`count(*) filter (where ${students.status} = 'Inadimplente')::int`,
          mrr: sql<string>`coalesce(sum(${students.value}) filter (where ${students.status} = 'Ativo'), 0)`,
          avgTicket: sql<string>`coalesce(avg(${students.value}) filter (where ${students.status} = 'Ativo'), 0)`,
          atRisk: sql<number>`count(*) filter (where ${students.risk} >= 60)::int`,
        })
        .from(students);

      await db
        .insert(dailyMetrics)
        .values({
          date: today,
          activeStudents: agg.active,
          mrr: String(agg.mrr),
          avgTicket: String(agg.avgTicket),
          overdueCount: agg.overdue,
          atRiskCount: agg.atRisk,
          computedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: dailyMetrics.date,
          set: {
            activeStudents: agg.active,
            mrr: String(agg.mrr),
            avgTicket: String(agg.avgTicket),
            overdueCount: agg.overdue,
            atRiskCount: agg.atRisk,
            computedAt: new Date(),
          },
        });

      const row = await db.query.dailyMetrics.findFirst({
        where: eq(dailyMetrics.date, today),
      });

      return { data: row };
    },
  );
}
