import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { students, trainingRoutines, trainings, trainingSessions } from "../db/schema.js";
import { studentAccessFilter } from "../services/students.service.js";

const exerciseSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(160),
  group: z.string().min(1).max(80),
  sets: z.number().int().min(1).max(20),
  reps: z.string().max(40),
  load: z.number().optional(),
  cadence: z.string().max(40).optional(),
  rest: z.string().max(40).optional(),
  technique: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
});

const routineBody = z.object({
  studentId: z.string().uuid(),
  name: z.string().min(2).max(120),
  objective: z.string().max(500).optional().nullable(),
  frequency: z.number().int().min(1).max(7).default(3),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  status: z.string().max(40).optional(),
  trainings: z
    .array(
      z.object({
        code: z.string().max(8),
        name: z.string().max(120),
        focus: z.string().max(120).optional().nullable(),
        dayOfWeek: z.string().max(20).optional().nullable(),
        duration: z.string().max(40).optional().nullable(),
        exercises: z.array(exerciseSchema).default([]),
      }),
    )
    .optional(),
});

const sessionBody = z.object({
  studentId: z.string().uuid(),
  trainingId: z.string().uuid().optional().nullable(),
  routineId: z.string().uuid().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "MISSED"]).default("COMPLETED"),
  notes: z.string().max(1000).optional().nullable(),
});

export async function trainingRoutes(fastify: FastifyInstance) {
  const staff = {
    preHandler: [
      fastify.authenticate,
      fastify.authorize(["ADMIN", "TRAINER", "FINANCE", "RECEPTION", "STUDENT"]),
    ],
  };
  const writers = {
    preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "TRAINER"])],
  };

  fastify.get("/routines", staff, async (request) => {
    const q = z.object({ studentId: z.string().uuid().optional() }).safeParse(request.query);
    const access = studentAccessFilter(request.user);

    let allowedIds: Set<string> | null = null;
    if (access) {
      const allowed = await db.select({ id: students.id }).from(students).where(access);
      allowedIds = new Set(allowed.map((s) => s.id));
    }

    const rows = await db
      .select()
      .from(trainingRoutines)
      .where(
        q.success && q.data.studentId
          ? eq(trainingRoutines.studentId, q.data.studentId)
          : undefined,
      )
      .orderBy(desc(trainingRoutines.createdAt));

    const filtered = allowedIds ? rows.filter((r) => allowedIds!.has(r.studentId)) : rows;

    if (request.user.role === "STUDENT" && request.user.studentId) {
      const own = filtered.filter((r) => r.studentId === request.user.studentId);
      return { data: await hydrateRoutines(own) };
    }

    return { data: await hydrateRoutines(filtered) };
  });

  fastify.post("/routines", writers, async (request, reply) => {
    const parsed = routineBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }

    const [routine] = await db
      .insert(trainingRoutines)
      .values({
        studentId: parsed.data.studentId,
        name: parsed.data.name,
        objective: parsed.data.objective ?? null,
        frequency: parsed.data.frequency,
        startDate: parsed.data.startDate ?? null,
        endDate: parsed.data.endDate ?? null,
        status: parsed.data.status ?? "Ativa",
      })
      .returning();

    let createdTrainings: (typeof trainings.$inferSelect)[] = [];
    if (parsed.data.trainings?.length) {
      createdTrainings = await db
        .insert(trainings)
        .values(
          parsed.data.trainings.map((t) => ({
            routineId: routine.id,
            code: t.code,
            name: t.name,
            focus: t.focus ?? null,
            dayOfWeek: t.dayOfWeek ?? null,
            duration: t.duration ?? null,
            exercises: t.exercises,
          })),
        )
        .returning();
    }

    return reply.status(201).send({ data: { ...routine, trainings: createdTrainings } });
  });

  fastify.patch<{ Params: { id: string } }>("/routines/:id", writers, async (request, reply) => {
    if (!z.string().uuid().safeParse(request.params.id).success) {
      return reply.status(400).send({ error: "InvalidId" });
    }
    const parsed = routineBody
      .partial()
      .omit({ studentId: true, trainings: true })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }
    const [row] = await db
      .update(trainingRoutines)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(trainingRoutines.id, request.params.id))
      .returning();
    if (!row) return reply.status(404).send({ error: "NotFound" });
    const hydrated = await hydrateRoutines([row]);
    return { data: hydrated[0] };
  });

  fastify.patch<{ Params: { id: string } }>("/trainings/:id", writers, async (request, reply) => {
    if (!z.string().uuid().safeParse(request.params.id).success) {
      return reply.status(400).send({ error: "InvalidId" });
    }
    const parsed = z
      .object({
        code: z.string().max(8).optional(),
        name: z.string().max(120).optional(),
        focus: z.string().max(120).optional().nullable(),
        dayOfWeek: z.string().max(20).optional().nullable(),
        duration: z.string().max(40).optional().nullable(),
        exercises: z.array(exerciseSchema).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }
    const [row] = await db
      .update(trainings)
      .set(parsed.data)
      .where(eq(trainings.id, request.params.id))
      .returning();
    if (!row) return reply.status(404).send({ error: "NotFound" });
    return { data: row };
  });

  fastify.post<{ Params: { id: string } }>(
    "/routines/:id/trainings",
    writers,
    async (request, reply) => {
      if (!z.string().uuid().safeParse(request.params.id).success) {
        return reply.status(400).send({ error: "InvalidId" });
      }
      const parsed = z
        .object({
          code: z.string().max(8),
          name: z.string().max(120),
          focus: z.string().max(120).optional().nullable(),
          dayOfWeek: z.string().max(20).optional().nullable(),
          duration: z.string().max(40).optional().nullable(),
          exercises: z.array(exerciseSchema).default([]),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
      }
      const routine = await db.query.trainingRoutines.findFirst({
        where: eq(trainingRoutines.id, request.params.id),
      });
      if (!routine) return reply.status(404).send({ error: "NotFound" });

      const [row] = await db
        .insert(trainings)
        .values({
          routineId: request.params.id,
          code: parsed.data.code,
          name: parsed.data.name,
          focus: parsed.data.focus ?? null,
          dayOfWeek: parsed.data.dayOfWeek ?? null,
          duration: parsed.data.duration ?? null,
          exercises: parsed.data.exercises,
        })
        .returning();
      return reply.status(201).send({ data: row });
    },
  );

  fastify.delete<{ Params: { id: string } }>("/routines/:id", writers, async (request, reply) => {
    if (!z.string().uuid().safeParse(request.params.id).success) {
      return reply.status(400).send({ error: "InvalidId" });
    }
    await db.delete(trainingRoutines).where(eq(trainingRoutines.id, request.params.id));
    return reply.status(204).send();
  });

  fastify.get("/sessions", staff, async (request) => {
    const q = z
      .object({
        studentId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .safeParse(request.query);

    const studentId =
      request.user.role === "STUDENT"
        ? (request.user.studentId ?? undefined)
        : q.success
          ? q.data.studentId
          : undefined;

    const rows = await db
      .select()
      .from(trainingSessions)
      .where(studentId ? eq(trainingSessions.studentId, studentId) : undefined)
      .orderBy(desc(trainingSessions.date))
      .limit(q.success ? (q.data.limit ?? 50) : 50);

    return { data: rows };
  });

  fastify.post("/sessions", staff, async (request, reply) => {
    const parsed = sessionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }

    if (request.user.role === "STUDENT" && request.user.studentId !== parsed.data.studentId) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const [row] = await db
      .insert(trainingSessions)
      .values({
        studentId: parsed.data.studentId,
        trainingId: parsed.data.trainingId ?? null,
        routineId: parsed.data.routineId ?? null,
        date: parsed.data.date,
        status: parsed.data.status,
        notes: parsed.data.notes ?? null,
      })
      .returning();

    if (parsed.data.status === "COMPLETED") {
      await db
        .update(students)
        .set({ lastCheckin: parsed.data.date, updatedAt: new Date() })
        .where(eq(students.id, parsed.data.studentId));

      if (parsed.data.routineId) {
        const routine = await db.query.trainingRoutines.findFirst({
          where: eq(trainingRoutines.id, parsed.data.routineId),
        });
        if (routine) {
          await db
            .update(trainingRoutines)
            .set({
              completedSessions: (routine.completedSessions ?? 0) + 1,
              updatedAt: new Date(),
            })
            .where(eq(trainingRoutines.id, parsed.data.routineId));
        }
      }
    }

    return reply.status(201).send({ data: row });
  });
}

async function hydrateRoutines(rows: (typeof trainingRoutines.$inferSelect)[]) {
  return Promise.all(
    rows.map(async (r) => {
      const t = await db.select().from(trainings).where(eq(trainings.routineId, r.id));
      const student = await db.query.students.findFirst({
        where: eq(students.id, r.studentId),
        columns: { id: true, name: true },
      });
      return { ...r, trainings: t, studentName: student?.name ?? null };
    }),
  );
}
