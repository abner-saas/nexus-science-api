import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../lib/env.js";
import {
  findUserByEmail,
  generateRefreshToken,
  persistRefreshToken,
  refreshExpiryDate,
  revokeRefreshToken,
  toJwtPayload,
  validateRefreshToken,
  verifyPassword,
} from "../services/auth.service.js";

const loginBody = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/auth/login",
    {
      config: {
        rateLimit: {
          // Dev/QA: login suites switch roles often; keep prod strict.
          max: env.NODE_ENV === "production" ? 5 : 200,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      const parsed = loginBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "ValidationError",
          issues: parsed.error.flatten(),
        });
      }

      const user = await findUserByEmail(parsed.data.email);
      if (!user || !user.active) {
        return reply
          .status(401)
          .send({ error: "InvalidCredentials", message: "E-mail ou senha inválidos" });
      }

      const ok = await verifyPassword(parsed.data.password, user.passwordHash);
      if (!ok) {
        return reply
          .status(401)
          .send({ error: "InvalidCredentials", message: "E-mail ou senha inválidos" });
      }

      const payload = toJwtPayload(user);
      const accessToken = await reply.jwtSign(payload);
      const refreshToken = generateRefreshToken();
      await persistRefreshToken(user.id, refreshToken, refreshExpiryDate(env.JWT_REFRESH_EXPIRES));

      const cookieOpts = {
        httpOnly: true,
        secure: env.COOKIE_SECURE,
        sameSite: env.COOKIE_SAME_SITE,
        path: "/",
        domain: env.COOKIE_DOMAIN === "localhost" ? undefined : env.COOKIE_DOMAIN,
      };

      reply
        .setCookie("access_token", accessToken, {
          ...cookieOpts,
          maxAge: 15 * 60,
        })
        .setCookie("refresh_token", refreshToken, {
          ...cookieOpts,
          maxAge: 7 * 24 * 60 * 60,
        });

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          studentId: user.studentId,
        },
      };
    },
  );

  fastify.post("/auth/refresh", async (request, reply) => {
    const token = request.cookies.refresh_token;
    if (!token) {
      return reply.status(401).send({ error: "Unauthorized", message: "Refresh token ausente" });
    }

    const user = await validateRefreshToken(token);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized", message: "Refresh token inválido" });
    }

    await revokeRefreshToken(token);
    const payload = toJwtPayload(user);
    const accessToken = await reply.jwtSign(payload);
    const newRefresh = generateRefreshToken();
    await persistRefreshToken(user.id, newRefresh, refreshExpiryDate(env.JWT_REFRESH_EXPIRES));

    const cookieOpts = {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: "strict" as const,
      path: "/",
      domain: env.COOKIE_DOMAIN === "localhost" ? undefined : env.COOKIE_DOMAIN,
    };

    reply
      .setCookie("access_token", accessToken, { ...cookieOpts, maxAge: 15 * 60 })
      .setCookie("refresh_token", newRefresh, { ...cookieOpts, maxAge: 7 * 24 * 60 * 60 });

    return { ok: true };
  });

  fastify.post("/auth/logout", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const token = request.cookies.refresh_token;
    if (token) await revokeRefreshToken(token);

    const clearOpts = {
      path: "/",
      domain: env.COOKIE_DOMAIN === "localhost" ? undefined : env.COOKIE_DOMAIN,
    };
    reply.clearCookie("access_token", clearOpts).clearCookie("refresh_token", clearOpts);
    return { ok: true };
  });

  fastify.get("/auth/me", { preHandler: [fastify.authenticate] }, async (request) => {
    const user = await findUserByEmail(request.user.email);
    return {
      user: user
        ? {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            studentId: user.studentId,
          }
        : null,
    };
  });
}
