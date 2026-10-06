import { fromNodeHeaders } from "better-auth/node";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { auth } from "../lib/better-auth.js";
import { type CheckoutCaller, openCheckoutSession } from "../services/checkout.service.js";
import { listUserIdsForPush, notifyUsers } from "../services/push-notification.service.js";
import type { UserRole } from "../types/auth.js";

const checkoutBody = z.object({
  planId: z.string().uuid(),
});

const STAFF_MESSAGE = "Equipe cadastra alunos pelo CRM";

type AppUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  studentId: string | null;
};

/**
 * Único lugar que promove lead (sessão better-auth sem row em `users`) a
 * aluno Pendente. Não usa `fastify.authenticate`: esse gate responde 403
 * LEAD e é o que o web `/conhecer` depende.
 */
export async function checkoutRoutes(fastify: FastifyInstance) {
  fastify.post("/checkout/sessions", async (request, reply) => {
    const parsed = checkoutBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }

    const resolved = await resolveCheckoutCaller(request, reply);
    if (!resolved) return;

    if (resolved.kind === "app" && resolved.user.role !== "STUDENT") {
      return reply.status(403).send({ error: "Forbidden", message: STAFF_MESSAGE });
    }

    const caller = toCaller(resolved);
    const result = await openCheckoutSession(caller, parsed.data.planId, { log: request.log });
    if (!result.ok) {
      return reply.status(result.statusCode).send({ error: result.error, message: result.message });
    }

    if (result.notifyName) {
      try {
        const userIds = await listUserIdsForPush({ roles: ["ADMIN", "RECEPTION"] });
        await notifyUsers(
          userIds,
          {
            title: "Novo checkout iniciado",
            body: `${result.notifyName} iniciou um checkout.`,
          },
          request.log,
        );
      } catch (err) {
        request.log.error({ err }, "Falha ao notificar checkout");
      }
    }

    return reply.status(result.statusCode).send({ data: result.data });
  });
}

function toCaller(
  resolved: { kind: "lead"; email: string; name: string } | { kind: "app"; user: AppUser },
): CheckoutCaller {
  if (resolved.kind === "lead") {
    return { kind: "lead", email: resolved.email, name: resolved.name };
  }
  return {
    kind: "student",
    userId: resolved.user.id,
    email: resolved.user.email,
    name: resolved.user.name,
    studentId: resolved.user.studentId,
  };
}

async function resolveCheckoutCaller(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return resolveBetterAuthCaller(request, reply);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, request.user.sub),
    columns: { id: true, email: true, name: true, role: true, studentId: true, active: true },
  });
  if (!user?.active) {
    reply.status(401).send({ error: "Unauthorized", message: "Usuário inativo ou inválido" });
    return null;
  }
  return { kind: "app" as const, user };
}

async function resolveBetterAuthCaller(request: FastifyRequest, reply: FastifyReply) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    const email = session?.user?.email?.toLowerCase().trim();
    if (!session?.user || !email) {
      reply.status(401).send({ error: "Unauthorized", message: "Token inválido ou expirado" });
      return null;
    }

    const user = await db.query.users.findFirst({
      where: sql`lower(${users.email}) = ${email}`,
      columns: { id: true, email: true, name: true, role: true, studentId: true, active: true },
    });
    if (!user) {
      return { kind: "lead" as const, ...personFromSession(session.user.name, email) };
    }
    if (!user.active) {
      reply.status(401).send({ error: "Unauthorized", message: "Usuário inativo ou inválido" });
      return null;
    }
    return { kind: "app" as const, user };
  } catch {
    reply.status(401).send({ error: "Unauthorized", message: "Token inválido ou expirado" });
    return null;
  }
}

function personFromSession(name: string | null | undefined, email: string) {
  const normalized = email.toLowerCase().trim().slice(0, 255);
  const trimmed = name?.trim();
  const display = (
    trimmed && trimmed.length > 0 ? trimmed : normalized.split("@")[0] || "Aluno"
  ).slice(0, 160);
  return { email: normalized, name: display };
}
