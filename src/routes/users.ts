import type { FastifyInstance } from "fastify";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { students, users } from "../db/schema.js";
import { hashPassword, revokeAllUserTokens } from "../services/auth.service.js";

const STAFF_ROLES = ["ADMIN", "TRAINER", "FINANCE", "RECEPTION"] as const;

/** Matriz de acesso — documentada na API e espelhada no front */
export const ROLE_MATRIX = {
  ADMIN: {
    label: "Administrador / Proprietário",
    description: "Acesso total: equipe, financeiro, CRM, treinos, configurações",
    modules: [
      "dashboard",
      "crm",
      "financeiro",
      "retencao",
      "treinos",
      "biofeedback",
      "avaliacao",
      "pagamentos",
      "planos",
      "ia",
      "configuracoes",
      "equipe",
    ],
  },
  TRAINER: {
    label: "Treinador / Coach",
    description:
      "Só alunos atribuídos a ele: CRM, treinos, biofeedback, avaliação. Sem financeiro.",
    modules: ["dashboard", "crm", "treinos", "biofeedback", "avaliacao", "retencao", "ia"],
  },
  FINANCE: {
    label: "Financeiro / Administrativo",
    description: "Financeiro, pagamentos, planos e CRM. Sem editar treinos/biofeedback.",
    modules: ["dashboard", "crm", "financeiro", "pagamentos", "planos", "retencao"],
  },
  RECEPTION: {
    label: "Recepção / Suporte",
    description: "Leitura do CRM e contatos. Sem dados financeiros sensíveis.",
    modules: ["dashboard", "crm"],
  },
  STUDENT: {
    label: "Aluno",
    description: "Somente app do aluno: próprios treinos, biofeedback e pagamentos.",
    modules: ["aluno"],
  },
} as const;

const createBody = z.object({
  name: z.string().min(2).max(160),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  role: z.enum(STAFF_ROLES),
  active: z.boolean().optional(),
});

const updateBody = z.object({
  name: z.string().min(2).max(160).optional(),
  email: z.string().email().max(255).optional(),
  password: z.string().min(8).max(128).optional(),
  role: z.enum(STAFF_ROLES).optional(),
  active: z.boolean().optional(),
});

function publicUser(row: typeof users.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    studentId: row.studentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    matrix: ROLE_MATRIX[row.role],
  };
}

export async function usersRoutes(fastify: FastifyInstance) {
  const adminOnly = {
    preHandler: [fastify.authenticate, fastify.authorize(["ADMIN"])],
  };

  fastify.get("/users/roles", { preHandler: [fastify.authenticate] }, async () => {
    return {
      data: Object.entries(ROLE_MATRIX).map(([role, meta]) => ({
        role,
        ...meta,
      })),
    };
  });

  fastify.get("/users", adminOnly, async () => {
    const rows = await db
      .select()
      .from(users)
      .where(ne(users.role, "STUDENT"))
      .orderBy(desc(users.createdAt));
    return { data: rows.map(publicUser) };
  });

  fastify.post("/users", adminOnly, async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const exists = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (exists) {
      return reply.status(409).send({ error: "Conflict", message: "E-mail já cadastrado" });
    }

    const [row] = await db
      .insert(users)
      .values({
        name: parsed.data.name.trim(),
        email,
        passwordHash: await hashPassword(parsed.data.password),
        role: parsed.data.role,
        active: parsed.data.active ?? true,
      })
      .returning();

    return reply.status(201).send({ data: publicUser(row) });
  });

  fastify.patch<{ Params: { id: string } }>("/users/:id", adminOnly, async (request, reply) => {
    if (!z.string().uuid().safeParse(request.params.id).success) {
      return reply.status(400).send({ error: "InvalidId" });
    }
    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }

    const target = await db.query.users.findFirst({
      where: eq(users.id, request.params.id),
    });
    if (!target || target.role === "STUDENT") {
      return reply.status(404).send({ error: "NotFound", message: "Usuário não encontrado" });
    }

    // Não permitir o único admin se desativar a si mesmo sem outro admin
    if (target.id === request.user.sub && parsed.data.active === false) {
      return reply.status(400).send({
        error: "BadRequest",
        message: "Você não pode desativar a própria conta",
      });
    }

    if (parsed.data.email) {
      const email = parsed.data.email.toLowerCase().trim();
      const clash = await db.query.users.findFirst({
        where: and(eq(users.email, email), ne(users.id, target.id)),
      });
      if (clash) {
        return reply.status(409).send({ error: "Conflict", message: "E-mail já cadastrado" });
      }
    }

    const [row] = await db
      .update(users)
      .set({
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.email !== undefined
          ? { email: parsed.data.email.toLowerCase().trim() }
          : {}),
        ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
        ...(parsed.data.password ? { passwordHash: await hashPassword(parsed.data.password) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, request.params.id))
      .returning();

    if (parsed.data.active === false || parsed.data.password) {
      await revokeAllUserTokens(request.params.id);
    }

    return { data: publicUser(row) };
  });

  /** Cria login do aluno (app) vinculado ao studentId — só ADMIN */
  fastify.post("/users/student-access", adminOnly, async (request, reply) => {
    const body = z
      .object({
        studentId: z.string().uuid(),
        email: z.string().email(),
        password: z.string().min(8).max(128),
        name: z.string().min(2).max(160).optional(),
      })
      .safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({ error: "ValidationError", issues: body.error.flatten() });
    }

    const email = body.data.email.toLowerCase().trim();
    const exists = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (exists) {
      return reply.status(409).send({ error: "Conflict", message: "E-mail já cadastrado" });
    }

    const [row] = await db
      .insert(users)
      .values({
        name: body.data.name?.trim() || email.split("@")[0],
        email,
        passwordHash: await hashPassword(body.data.password),
        role: "STUDENT",
        studentId: body.data.studentId,
        active: true,
      })
      .returning();

    await db
      .update(students)
      .set({ appAccess: true, email, updatedAt: new Date() })
      .where(eq(students.id, body.data.studentId));

    return reply.status(201).send({ data: publicUser(row) });
  });
}
