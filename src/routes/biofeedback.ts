import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { env } from "../lib/env.js";
import { db } from "../db/index.js";
import { biofeedback, students } from "../db/schema.js";

const entryBody = z.object({
  studentId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  energy: z.number().int().min(1).max(10).optional().nullable(),
  mood: z.number().int().min(1).max(10).optional().nullable(),
  stress: z.number().int().min(1).max(10).optional().nullable(),
  sleep: z.number().int().min(1).max(10).optional().nullable(),
  sleepHours: z
    .string()
    .regex(/^\d+(\.\d{1})?$/)
    .optional()
    .nullable(),
  hydration: z
    .string()
    .regex(/^\d+(\.\d{1})?$/)
    .optional()
    .nullable(),
  musclePain: z.number().int().min(1).max(10).optional().nullable(),
  weight: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional()
    .nullable(),
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
    const parsed = entryBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }

    if (request.user.role === "STUDENT" && request.user.studentId !== parsed.data.studentId) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const [row] = await db
      .insert(biofeedback)
      .values({
        studentId: parsed.data.studentId,
        date: parsed.data.date,
        energy: parsed.data.energy ?? null,
        mood: parsed.data.mood ?? null,
        stress: parsed.data.stress ?? null,
        sleep: parsed.data.sleep ?? null,
        sleepHours: parsed.data.sleepHours ?? null,
        hydration: parsed.data.hydration ?? null,
        musclePain: parsed.data.musclePain ?? null,
        weight: parsed.data.weight ?? null,
        heightCm: parsed.data.heightCm ?? null,
        calories: parsed.data.calories ?? null,
        hr: parsed.data.hr ?? null,
        steps: parsed.data.steps ?? null,
      })
      .onConflictDoUpdate({
        target: [biofeedback.studentId, biofeedback.date],
        set: {
          energy: parsed.data.energy ?? null,
          mood: parsed.data.mood ?? null,
          stress: parsed.data.stress ?? null,
          sleep: parsed.data.sleep ?? null,
          sleepHours: parsed.data.sleepHours ?? null,
          hydration: parsed.data.hydration ?? null,
          musclePain: parsed.data.musclePain ?? null,
          weight: parsed.data.weight ?? null,
          heightCm: parsed.data.heightCm ?? null,
          calories: parsed.data.calories ?? null,
          hr: parsed.data.hr ?? null,
          steps: parsed.data.steps ?? null,
        },
      })
      .returning();

    await db
      .update(students)
      .set({
        lastBiofeedback: parsed.data.date,
        monthlyWeight: parsed.data.weight ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(students.id, parsed.data.studentId));

    return reply.status(201).send({ data: row });
  });

  /** IA interpretativa — últimos 7 dias + objetivo do aluno */
  fastify.post("/biofeedback/insight", staff, async (request, reply) => {
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

  const avg = (key: "energy" | "mood" | "stress" | "sleep" | "musclePain") => {
    const vals = rows.map((r) => r[key]).filter((v): v is number => v != null);
    if (!vals.length) return null;
    return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  };

  // Fallback local se não houver API key (não bloqueia o produto)
  if (!env.OPENAI_API_KEY && !env.GEMINI_API_KEY) {
    const energy = avg("energy");
    const stress = avg("stress");
    const sleep = avg("sleep");
    const pain = avg("musclePain");
    const parts: string[] = [
      `Insight científico (local) para ${name} — objetivo: ${goal ?? "não informado"}.`,
      `Últimos ${rows.length} dias: energia média ${energy ?? "n/d"}, sono ${sleep ?? "n/d"}, estresse ${stress ?? "n/d"}, dor muscular ${pain ?? "n/d"}.`,
    ];
    if (stress != null && stress >= 7) {
      parts.push(
        "Estresse elevado: priorize volume moderado, técnicas de respiração e sono consistente (7–9h). Evite PRs sob alta carga simpática.",
      );
    }
    if (sleep != null && sleep <= 5) {
      parts.push(
        "Qualidade de sono baixa correlaciona com recuperação prejudicada e risco de overreaching. Reduza intensidade 10–20% até normalizar.",
      );
    }
    if (pain != null && pain >= 7) {
      parts.push(
        "Dor muscular alta: revise amplitude e carga nos grupos afetados; inclua mobilidade e deload se persistir >72h.",
      );
    }
    if (energy != null && energy >= 8 && (stress ?? 5) <= 4) {
      parts.push(
        "Janela favorável de performance: boa energia e estresse controlado — momento adequado para progressão de carga.",
      );
    }
    parts.push(
      "Configure OPENAI_API_KEY ou GEMINI_API_KEY para insights gerados por modelo com base em artigos e contexto clínico-esportivo.",
    );
    return parts.join("\n\n");
  }

  const prompt = `Você é um consultor de ciências do exercício. Analise o biofeedback dos últimos 7 dias do aluno ${name} (objetivo: ${goal ?? "n/d"}).
Dados JSON: ${JSON.stringify(summary)}
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
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Especialista em fisiologia do exercício e biofeedback." },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 600,
    }),
  });
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "Não foi possível gerar insight.";
}
