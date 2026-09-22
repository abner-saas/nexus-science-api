import fp from "fastify-plugin";
import fjwt from "@fastify/jwt";
import fcookie from "@fastify/cookie";
import type { FastifyReply, FastifyRequest } from "fastify";
import { eq, sql } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import { env } from "../lib/env.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { auth } from "../lib/better-auth.js";
import { ensureAppUserFromOAuth } from "../services/oauth-user.service.js";
import type { JwtPayload, UserRole } from "../types/auth.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (
      roles: UserRole[],
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(async (fastify) => {
  await fastify.register(fcookie);

  await fastify.register(fjwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_EXPIRES },
    cookie: {
      cookieName: "access_token",
      signed: false,
    },
  });

  fastify.decorate("authenticate", async (request, reply) => {
    const applyUser = async (userId: string) => {
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { id: true, active: true, role: true, studentId: true, email: true },
      });
      if (!user || !user.active) return null;
      request.user = {
        sub: user.id,
        email: user.email,
        role: user.role,
        studentId: user.studentId,
      };
      return user;
    };

    try {
      await request.jwtVerify();
      const user = await applyUser(request.user.sub);
      if (!user) {
        return reply
          .status(401)
          .send({ error: "Unauthorized", message: "Usuário inativo ou inválido" });
      }
      return;
    } catch {
      /* try Better Auth session next */
    }

    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      const email = session?.user?.email?.toLowerCase();
      if (!session?.user || !email) {
        return reply
          .status(401)
          .send({ error: "Unauthorized", message: "Token inválido ou expirado" });
      }
      if (session.user.emailVerified === false) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "E-mail Google não verificado",
        });
      }
      let row = await db.query.users.findFirst({
        where: sql`lower(${users.email}) = ${email}`,
        columns: { id: true, active: true, role: true, studentId: true, email: true },
      });
      if (!row) {
        const provisioned = await ensureAppUserFromOAuth({
          email,
          name: session.user.name,
        });
        row = {
          id: provisioned.id,
          active: provisioned.active,
          role: provisioned.role,
          studentId: provisioned.studentId,
          email: provisioned.email,
        };
      }
      if (!row.active) {
        return reply
          .status(401)
          .send({ error: "Unauthorized", message: "Usuário inativo ou inválido" });
      }
      request.user = {
        sub: row.id,
        email: row.email,
        role: row.role,
        studentId: row.studentId,
      };
    } catch {
      return reply
        .status(401)
        .send({ error: "Unauthorized", message: "Token inválido ou expirado" });
    }
  });

  fastify.decorate("authorize", (roles: UserRole[]) => {
    return async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      if (!roles.includes(request.user.role)) {
        return reply.status(403).send({
          error: "Forbidden",
          message: "Você não tem permissão para este recurso",
        });
      }
    };
  });
});
