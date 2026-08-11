import type { FastifyInstance } from "fastify";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { dailyMetrics, students } from "../db/schema.js";

export async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/dashboard/summary",
    {
      preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "FINANCE", "TRAINER"])],
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
          atRisk: sql<number>`count(*) filter (where ${students.risk} >= 60)::int`,
          noBio7d: sql<number>`count(*) filter (where ${students.status} = 'Ativo' and (${students.lastBiofeedback} is null or ${students.lastBiofeedback} < current_date - 7))::int`,
          absent14d: sql<number>`count(*) filter (where ${students.status} = 'Ativo' and (${students.lastCheckin} is null or ${students.lastCheckin} < current_date - 14))::int`,
          mrr: sql<string>`coalesce(sum(${students.value}) filter (where ${students.status} = 'Ativo'), 0)`,
          avgTicket: sql<string>`coalesce(avg(${students.value}) filter (where ${students.status} = 'Ativo'), 0)`,
        })
        .from(students);

      const alerts = await db
        .select({
          id: students.id,
          name: students.name,
          status: students.status,
          risk: students.risk,
          lastBiofeedback: students.lastBiofeedback,
          lastCheckin: students.lastCheckin,
          renewDate: students.renewDate,
        })
        .from(students)
        .where(
          sql`${students.status} in ('Ativo', 'Inadimplente') and (
            ${students.risk} >= 60
            or ${students.status} = 'Inadimplente'
            or ${students.lastBiofeedback} is null
            or ${students.lastBiofeedback} < current_date - 7
            or ${students.lastCheckin} is null
            or ${students.lastCheckin} < current_date - 14
          )`,
        )
        .limit(12);

      return {
        data: {
          metrics: latest ?? {
            mrr: counts.mrr,
            avgTicket: counts.avgTicket,
            overdueCount: counts.overdue,
            atRiskCount: counts.atRisk,
            activeStudents: counts.active,
          },
          students: counts,
          alerts: alerts.map((a) => ({
            ...a,
            message:
              a.status === "Inadimplente"
                ? "Inadimplente — acionar cobrança"
                : (a.risk ?? 0) >= 60
                  ? "Alto risco de churn"
                  : !a.lastBiofeedback ||
                      new Date(a.lastBiofeedback) < new Date(Date.now() - 7 * 86400000)
                    ? "Sem biofeedback há 7+ dias"
                    : "Ausente há 14+ dias",
          })),
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
