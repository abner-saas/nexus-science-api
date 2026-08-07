import type { FastifyInstance } from "fastify";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { students, biofeedback } from "../db/schema.js";

export async function retentionRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/retention",
    {
      preHandler: [
        fastify.authenticate,
        fastify.authorize(["ADMIN", "TRAINER", "FINANCE"]),
      ],
    },
    async () => {
      const all = await db.select().from(students);
      const active = all.filter((s) => s.status === "Ativo");
      const cancelled = all.filter((s) => s.status === "Cancelado");
      const totalRelevant = active.length + cancelled.length;
      const retentionRate =
        totalRelevant > 0 ? (active.length / totalRelevant) * 100 : 100;
      const churnRate = 100 - retentionRate;

      const avgLtv =
        active.length > 0
          ? active.reduce((sum, s) => {
              const months = Math.max(
                1,
                Math.floor(
                  (Date.now() - new Date(s.entryDate).getTime()) /
                    (30 * 24 * 60 * 60 * 1000),
                ),
              );
              return sum + Number(s.value ?? 0) * months;
            }, 0) / active.length
          : 0;

      const atRisk = all
        .filter((s) => s.status === "Ativo" || s.status === "Inadimplente")
        .map((s) => {
          const reasons: string[] = [];
          if ((s.risk ?? 0) >= 60) reasons.push("Score de risco alto");
          if ((s.engagement ?? 100) < 50) reasons.push("Engajamento baixo");
          if (s.status === "Inadimplente") reasons.push("Inadimplência");
          if (s.lastBiofeedback) {
            const days =
              (Date.now() - new Date(s.lastBiofeedback).getTime()) /
              (24 * 60 * 60 * 1000);
            if (days >= 7) reasons.push("Sem biofeedback há 7+ dias");
          } else {
            reasons.push("Sem biofeedback registrado");
          }
          if (s.lastCheckin) {
            const days =
              (Date.now() - new Date(s.lastCheckin).getTime()) /
              (24 * 60 * 60 * 1000);
            if (days >= 14) reasons.push("Ausente há 14+ dias");
          }
          const score = Math.min(
            100,
            (s.risk ?? 0) +
              (reasons.includes("Inadimplência") ? 20 : 0) +
              (reasons.some((r) => r.includes("biofeedback")) ? 15 : 0) +
              (reasons.some((r) => r.includes("Ausente")) ? 15 : 0),
          );
          return {
            id: s.id,
            name: s.name,
            status: s.status,
            risk: s.risk,
            engagement: s.engagement,
            score,
            reasons,
            action:
              score >= 70
                ? "Contatar hoje via WhatsApp"
                : score >= 40
                  ? "Agendar check-in esta semana"
                  : "Monitorar",
          };
        })
        .filter((s) => s.score >= 40 || (s.risk ?? 0) >= 50)
        .sort((a, b) => b.score - a.score);

      const revenueAtRisk = atRisk.reduce((sum, s) => {
        const st = all.find((x) => x.id === s.id);
        return sum + Number(st?.value ?? 0);
      }, 0);

      return {
        data: {
          retentionRate: +retentionRate.toFixed(1),
          churnRate: +churnRate.toFixed(1),
          avgLtv: +avgLtv.toFixed(2),
          revenueAtRisk,
          atRisk,
        },
      };
    },
  );
}

export async function aiInsightsRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/ai/insights",
    {
      preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "TRAINER", "FINANCE"])],
    },
    async () => {
      const [counts] = await db
        .select({
          active: sql<number>`count(*) filter (where ${students.status} = 'Ativo')::int`,
          overdue: sql<number>`count(*) filter (where ${students.status} = 'Inadimplente')::int`,
          atRisk: sql<number>`count(*) filter (where ${students.risk} >= 60)::int`,
          noBio: sql<number>`count(*) filter (where ${students.status} = 'Ativo' and (${students.lastBiofeedback} is null or ${students.lastBiofeedback} < current_date - 7))::int`,
          mrr: sql<string>`coalesce(sum(${students.value}) filter (where ${students.status} = 'Ativo'), 0)`,
        })
        .from(students);

      const insights = [
        {
          type: "risk",
          title: "Alunos em risco",
          body: `${counts.atRisk} aluno(s) com score ≥ 60. Priorize contato e revisão de treino/biofeedback.`,
          priority: counts.atRisk > 0 ? "high" : "low",
        },
        {
          type: "billing",
          title: "Inadimplência",
          body: `${counts.overdue} inadimplente(s). Acione régua de cobrança e WhatsApp.`,
          priority: counts.overdue > 0 ? "high" : "low",
        },
        {
          type: "engagement",
          title: "Biofeedback em atraso",
          body: `${counts.noBio} ativo(s) sem biofeedback há 7+ dias — impacto direto na retenção.`,
          priority: counts.noBio > 0 ? "medium" : "low",
        },
        {
          type: "growth",
          title: "MRR atual",
          body: `Receita recorrente: R$ ${Number(counts.mrr).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} com ${counts.active} alunos ativos.`,
          priority: "info",
        },
        {
          type: "upsell",
          title: "Oportunidade de upsell",
          body: "Revise alunos Bronze com alta aderência para oferta Silver/Gold no próximo ciclo.",
          priority: "medium",
        },
      ];

      const recentBio = await db
        .select()
        .from(biofeedback)
        .orderBy(desc(biofeedback.date))
        .limit(5);

      return {
        data: {
          insights,
          executiveSummary: `Operação com ${counts.active} ativos. Foque em inadimplentes (${counts.overdue}), risco de churn (${counts.atRisk}) e reativação de biofeedback (${counts.noBio}).`,
          recentBioCount: recentBio.length,
        },
      };
    },
  );
}
