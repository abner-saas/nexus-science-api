import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { assessments, students } from "../db/schema.js";
import { encryptField, decryptField } from "../lib/encryption.js";

const assessmentBody = z.object({
  studentId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weight: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  heightCm: z.number().int().min(100).max(250).optional().nullable(),
  bodyFat: z.string().regex(/^\d+(\.\d{1})?$/).optional().nullable(),
  muscle: z.string().regex(/^\d+(\.\d{1})?$/).optional().nullable(),
  waist: z.string().regex(/^\d+(\.\d{1})?$/).optional().nullable(),
  hip: z.string().regex(/^\d+(\.\d{1})?$/).optional().nullable(),
  thigh: z.string().regex(/^\d+(\.\d{1})?$/).optional().nullable(),
  arm: z.string().regex(/^\d+(\.\d{1})?$/).optional().nullable(),
  photoUrls: z.array(z.string().url()).max(10).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

function calcBmi(weight?: string | null, heightCm?: number | null) {
  if (!weight || !heightCm) return null;
  const w = Number(weight);
  const h = heightCm / 100;
  if (!w || !h) return null;
  return (w / (h * h)).toFixed(1);
}

export async function assessmentsRoutes(fastify: FastifyInstance) {
  const staff = {
    preHandler: [
      fastify.authenticate,
      fastify.authorize(["ADMIN", "TRAINER", "STUDENT"]),
    ],
  };

  fastify.get("/assessments", staff, async (request, reply) => {
    const q = z.object({ studentId: z.string().uuid() }).safeParse(request.query);
    if (!q.success) {
      return reply.status(400).send({ error: "ValidationError" });
    }
    if (request.user.role === "STUDENT" && request.user.studentId !== q.data.studentId) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const rows = await db
      .select()
      .from(assessments)
      .where(eq(assessments.studentId, q.data.studentId))
      .orderBy(desc(assessments.date));

    return {
      data: rows.map((r) => ({
        ...r,
        notes: r.notesEncrypted
          ? (() => {
              try {
                return decryptField(r.notesEncrypted!);
              } catch {
                return null;
              }
            })()
          : null,
        notesEncrypted: undefined,
      })),
    };
  });

  fastify.post("/assessments", {
    preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "TRAINER"])],
  }, async (request, reply) => {
    const parsed = assessmentBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }

    const bmi = calcBmi(parsed.data.weight, parsed.data.heightCm);
    const [row] = await db
      .insert(assessments)
      .values({
        studentId: parsed.data.studentId,
        date: parsed.data.date,
        weight: parsed.data.weight ?? null,
        heightCm: parsed.data.heightCm ?? null,
        bmi,
        bodyFat: parsed.data.bodyFat ?? null,
        muscle: parsed.data.muscle ?? null,
        waist: parsed.data.waist ?? null,
        hip: parsed.data.hip ?? null,
        thigh: parsed.data.thigh ?? null,
        arm: parsed.data.arm ?? null,
        photoUrls: parsed.data.photoUrls ?? [],
        notesEncrypted: parsed.data.notes ? encryptField(parsed.data.notes) : null,
      })
      .returning();

    if (parsed.data.weight) {
      await db
        .update(students)
        .set({
          monthlyWeight: parsed.data.weight,
          heightCm: parsed.data.heightCm ?? undefined,
          updatedAt: new Date(),
        })
        .where(eq(students.id, parsed.data.studentId));
    }

    return reply.status(201).send({ data: row });
  });
}
