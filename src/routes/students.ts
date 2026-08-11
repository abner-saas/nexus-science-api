import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createStudent,
  deleteStudent,
  getStudentById,
  listStudents,
  updateStudent,
} from "../services/students.service.js";

const studentBody = z.object({
  name: z.string().min(2).max(160),
  phone: z.string().max(20).optional().nullable(),
  email: z.string().email().max(255).optional().nullable(),
  instagram: z.string().max(80).optional().nullable(),
  sex: z.enum(["M", "F", "O"]).optional().nullable(),
  birthdate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  city: z.string().max(80).optional().nullable(),
  state: z.string().length(2).optional().nullable(),
  goal: z.string().max(120).optional().nullable(),
  restrictions: z.string().max(2000).optional().nullable(),
  planId: z.string().uuid().optional().nullable(),
  trainerId: z.string().uuid().optional().nullable(),
  value: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional()
    .nullable(),
  status: z.enum(["Ativo", "Pausado", "Inadimplente", "Cancelado"]).optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  renewDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  cancelDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  origin: z.string().max(60).optional().nullable(),
  priority: z.enum(["Alta", "Média", "Baixa"]).optional().nullable(),
  heightCm: z.number().int().min(100).max(250).optional().nullable(),
});

const updateBody = studentBody.partial().extend({
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const listQuery = z.object({
  q: z.string().max(120).optional(),
  status: z.enum(["Ativo", "Pausado", "Inadimplente", "Cancelado"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function studentsRoutes(fastify: FastifyInstance) {
  const staff = {
    preHandler: [
      fastify.authenticate,
      fastify.authorize(["ADMIN", "TRAINER", "FINANCE", "RECEPTION"]),
    ],
  };

  const writers = {
    preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "TRAINER", "FINANCE"])],
  };

  const admins = {
    preHandler: [fastify.authenticate, fastify.authorize(["ADMIN"])],
  };

  fastify.get("/students", staff, async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "ValidationError", issues: query.error.flatten() });
    }
    const data = await listStudents(request.user, query.data);
    return { data };
  });

  fastify.get<{ Params: { id: string } }>("/students/:id", staff, async (request, reply) => {
    if (!z.string().uuid().safeParse(request.params.id).success) {
      return reply.status(400).send({ error: "InvalidId" });
    }
    const student = await getStudentById(request.user, request.params.id);
    if (!student) {
      return reply.status(404).send({ error: "NotFound", message: "Aluno não encontrado" });
    }
    return { data: student };
  });

  fastify.post("/students", writers, async (request, reply) => {
    const parsed = studentBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }
    const data = await createStudent(parsed.data);
    return reply.status(201).send({ data });
  });

  fastify.patch<{ Params: { id: string } }>("/students/:id", writers, async (request, reply) => {
    if (!z.string().uuid().safeParse(request.params.id).success) {
      return reply.status(400).send({ error: "InvalidId" });
    }
    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }
    const data = await updateStudent(request.user, request.params.id, parsed.data);
    if (!data) {
      return reply.status(404).send({ error: "NotFound", message: "Aluno não encontrado" });
    }
    return { data };
  });

  fastify.delete<{ Params: { id: string } }>("/students/:id", admins, async (request, reply) => {
    if (!z.string().uuid().safeParse(request.params.id).success) {
      return reply.status(400).send({ error: "InvalidId" });
    }
    const ok = await deleteStudent(request.user, request.params.id);
    if (!ok) {
      return reply.status(404).send({ error: "NotFound", message: "Aluno não encontrado" });
    }
    return reply.status(204).send();
  });
}
