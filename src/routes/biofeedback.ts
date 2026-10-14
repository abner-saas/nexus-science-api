import { and, desc, eq, gte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { biofeedback, students } from "../db/schema.js";
import { bioUpdateSet, buildLocalInsight, coerceDecimal } from "../domain/bio-metrics.js";
import { env } from "../lib/env.js";
import { allowStudentContent } from "../services/billing.service.js";

const entryBody = z.object({
  studentId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  energy: z.number().int().min(1).max(10).optional().nullable(),
  mood: z.number().int().min(1).max(10).optional().nullable(),
  stress: z.number().int().min(1).max(10).optional().nullable(),
  sleep: z.number().int().min(1).max(10).optional().nullable(),
  sleepHours: z.union([z.string(), z.number(), z.null()]).optional(),
  hydration: z.union([z.string(), z.number(), z.null()]).optional(),
  musclePain: z.number().int().min(1).max(10).optional().nullable(),
  weight: z.union([z.string(), z.number(), z.null()]).optional(),
  heightCm: z.number().int().min(100).max(250).optional().nullable(),
  calories: z.number().int().min(0).max(10000).optional().nullable(),
  hr: z.number().int().min(30).max(220).optional().nullable(),
  steps: z.number().int().min(0).max(100000).optional().nullable(),
});

export async function biofeedbackRoutes(fastify: FastifyInstance) {
  const staff = {
    preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "TRAINER", "STUDENT"])],
  };

  fastify.get("/biofeedback", staff, async (request, reply) => {
    if (!(await allowStudentContent(request, reply))) return;
    const q = z
      .object({
        studentId: z.string().uuid(),
        days: z.coerce.number().int().min(1).max(90).optional(),
      })
      .safeParse(request.query);

    if (!q.success) {
      return reply.status(400).send({ error: "ValidationError", issues: q.error.flatten() });
    }

    if (request.user.role === "STUDENT" && request.user.studentId !== q.data.studentId) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const days = q.data.days ?? 30;
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    const rows = await db
      .select()
      .from(biofeedback)
      .where(and(eq(biofeedback.studentId, q.data.studentId), gte(biofeedback.date, sinceStr)))
      .orderBy(desc(biofeedback.date));

    return { data: rows };
  });

  fastify.post("/biofeedback", staff, async (request, reply) => {
    if (!(await allowStudentContent(request, reply))) return;
    const parsed = entryBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }

    if (request.user.role === "STUDENT" && request.user.studentId !== parsed.data.studentId) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const sleepHours = coerceDecimal(parsed.data.sleepHours, 1);
    const hydration = coerceDecimal(parsed.data.hydration, 1);
    const weight = coerceDecimal(parsed.data.weight, 2);
    if (!sleepHours.ok || !hydration.ok || !weight.ok) {
      return reply.status(400).send({
        error: "ValidationError",
        message: "Hidratação, sono ou peso em formato inválido. Use número, como 2,5.",
      });
    }

    const metrics = bioUpdateSet({
      energy: parsed.data.energy,
      mood: parsed.data.mood,
      stress: parsed.data.stress,
      sleep: parsed.data.sleep,
      sleepHours: sleepHours.value,
      hydration: hydration.value,
      musclePain: parsed.data.musclePain,
      weight: weight.value,
      heightCm: parsed.data.heightCm,
      calories: parsed.data.calories,
      hr: parsed.data.hr,
      steps: parsed.data.steps,
    });

    const [row] = await db
      .insert(biofeedback)
      .values({
        studentId: parsed.data.studentId,
        date: parsed.data.date,
        ...metrics,
      })
      .onConflictDoUpdate({
        target: [biofeedback.studentId, biofeedback.date],
        set: Object.keys(metrics).length > 0 ? metrics : { date: parsed.data.date },
      })
      .returning();

    await db
      .update(students)
      .set({
        lastBiofeedback: parsed.data.date,
        ...(typeof weight.value === "string" ? { monthlyWeight: weight.value } : {}),
        updatedAt: new Date(),
      })
      .where(eq(students.id, parsed.data.studentId));

    return reply.status(201).send({ data: row });
  });

  /** IA interpretativa — últimos 7 dias + objetivo do aluno */
  fastify.post("/biofeedback/insight", staff, async (request, reply) => {
    if (!(await allowStudentContent(request, reply))) return;
    const body = z.object({ studentId: z.string().uuid() }).safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "ValidationError" });
    }

    const student = await db.query.students.findFirst({
      where: eq(students.id, body.data.studentId),
    });
    if (!student) return reply.status(404).send({ error: "NotFound" });

    const since = new Date();
    since.setDate(since.getDate() - 7);
    const rows = await db
      .select()
      .from(biofeedback)
      .where(
        and(
          eq(biofeedback.studentId, body.data.studentId),
          gte(biofeedback.date, since.toISOString().slice(0, 10)),
        ),
      )
      .orderBy(desc(biofeedback.date));

    const insight = await generateInsight(student.name, student.goal, rows);

    if (rows[0]) {
      await db
        .update(biofeedback)
        .set({ aiInsight: insight })
        .where(eq(biofeedback.id, rows[0].id));
    }

    return { data: { insight, daysAnalyzed: rows.length } };
  });
}

async function generateInsight(
  name: string,
  goal: string | null,
  rows: (typeof biofeedback.$inferSelect)[],
): Promise<string> {
  const summary = rows.map((r) => ({
    date: r.date,
    energy: r.energy,
    mood: r.mood,
    stress: r.stress,
    sleep: r.sleep,
    sleepHours: r.sleepHours,
    hydration: r.hydration,
    musclePain: r.musclePain,
    weight: r.weight,
  }));

  if (!env.OPENAI_API_KEY && !env.GEMINI_API_KEY) {
    return buildLocalInsight(name, goal, rows);
  }

  const prompt = `Você é um consultor de ciências do exercício. Analise o biofeedback dos últimos 7 dias do aluno ${name} (objetivo: ${goal ?? "n/d"}).
Dados JSON: ${JSON.stringify(summary)}
Considere energia, humor, estresse, sono, hidratação e dor muscular. Não ignore humor nem hidratação quando os valores existirem.
Escreva em português do Brasil, tom sóbrio e científico (Nexus Science), com: (1) leitura geral, (2) alertas, (3) ajustes de treino/recuperação, (4) recomendações práticas. Máx. 350 palavras.`;

  if (env.AI_PROVIDER === "gemini" && env.GEMINI_API_KEY) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "Não foi possível gerar insight.";
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      messages: [
        { role: "system", content: "Especialista em fisiologia do exercício e biofeedback." },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      reasoning_effort: "none",
      max_completion_tokens: 600,
    }),
  });
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "Não foi possível gerar insight.";
}
