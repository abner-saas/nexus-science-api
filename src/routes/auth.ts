import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { auth } from "../lib/better-auth.js";
import { env } from "../lib/env.js";
import {
  findUserByEmail,
  generateRefreshToken,
  persistRefreshToken,
  refreshExpiryDate,
  revokeRefreshToken,
  toJwtPayload,
  validateRefreshToken,
} from "../services/auth.service.js";
import { syncStudentBilling } from "../services/billing.service.js";
import { ensureAppUserFromOAuth } from "../services/oauth-user.service.js";

const loginBody = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

const sessionCookieOptions = {
  path: "/",
  domain: env.COOKIE_DOMAIN === "localhost" ? undefined : env.COOKIE_DOMAIN,
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAME_SITE,
};

const ACCESS_TOKEN_MAX_AGE = 15 * 60;
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60;

/**
 * Forwards every `Set-Cookie` header from a better-auth `auth.api.*` call
 * (invoked with `returnHeaders: true`) onto the Fastify reply. Needed because
 * `auth.api.*` runs in-process (no real HTTP round-trip), so the session
 * cookie better-auth wants to set never reaches the client unless we copy it
 * over ourselves.
 */
function forwardSetCookies(reply: FastifyReply, headers: Headers) {
  const cookies = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (cookies.length > 0) reply.header("set-cookie", cookies);
}

export async function authRoutes(fastify: FastifyInstance) {
  // Thin wrapper over better-auth's `/sign-in/email` — kept as `/auth/login`
  // (rather than switching the frontend to `/api/auth/sign-in/email` directly)
  // to avoid touching `nexus-science-web/src/lib/api.ts`'s contract. E-mail/senha
  // auth itself is 100% better-auth under the hood now (see `src/lib/better-auth.ts`);
  // this route only translates request/response shape and forwards cookies.
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

      let signIn: { headers: Headers; response: { user: { email: string } } };
      try {
        signIn = await auth.api.signInEmail({
          body: { email: parsed.data.email, password: parsed.data.password },
          headers: fromNodeHeaders(request.headers),
          returnHeaders: true,
        });
      } catch {
        return reply
          .status(401)
          .send({ error: "InvalidCredentials", message: "E-mail ou senha inválidos" });
      }

      forwardSetCookies(reply, signIn.headers);

      const email = signIn.response.user.email.toLowerCase();
      const user = await findUserByEmail(email);
      if (!user || !user.active) {
        // Credentials are valid at the better-auth layer (e.g. a lead who
        // signed up via `/api/auth/sign-up/email` but has no matching
        // `students` record yet) — mirrors the Google OAuth "lead" case in
        // `src/plugins/auth.ts`.
        return reply.status(403).send({
          error: "LeadAccess",
          code: "LEAD",
          message: "Conta reconhecida, mas sem acesso liberado. Solicite acesso ao treinador.",
        });
      }

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

  // Legacy custom-JWT refresh — kept read-only for sessions issued before this
  // migration (`access_token`/`refresh_token` cookies). `/auth/login` no longer
  // issues these, so this branch naturally retires as old sessions expire
  // (refresh tokens are 7d). For better-auth sessions, nothing needs to
  // happen here: better-auth's own session cookie manages its own renewal.
  fastify.post("/auth/refresh", async (request, reply) => {
    const legacyToken = request.cookies.refresh_token;
    if (legacyToken) {
      const user = await validateRefreshToken(legacyToken);
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized", message: "Refresh token inválido" });
      }

      await revokeRefreshToken(legacyToken);
      const payload = toJwtPayload(user);
      const accessToken = await reply.jwtSign(payload);
      const newRefresh = generateRefreshToken();
      await persistRefreshToken(user.id, newRefresh, refreshExpiryDate(env.JWT_REFRESH_EXPIRES));

      reply
        .setCookie("access_token", accessToken, {
          ...sessionCookieOptions,
          maxAge: ACCESS_TOKEN_MAX_AGE,
        })
        .setCookie("refresh_token", newRefresh, {
          ...sessionCookieOptions,
          maxAge: REFRESH_TOKEN_MAX_AGE,
        });

      return { ok: true };
    }

    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session?.user) {
      return reply
        .status(401)
        .send({ error: "Unauthorized", message: "Sessão ausente ou expirada" });
    }
    return { ok: true };
  });

  fastify.post("/auth/logout", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const legacyToken = request.cookies.refresh_token;
    if (legacyToken) await revokeRefreshToken(legacyToken);

    try {
      const { headers } = await auth.api.signOut({
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      });
      forwardSetCookies(reply, headers);
    } catch {
      /* no Better Auth session to sign out of */
    }

    reply
      .clearCookie("access_token", sessionCookieOptions)
      .clearCookie("refresh_token", sessionCookieOptions);
    return { ok: true };
  });

  fastify.get("/auth/whoami", async (request) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    const email = session?.user?.email?.toLowerCase().trim();
    if (!session?.user || !email) {
      return { data: { kind: "guest" as const } };
    }

    const linked = await ensureAppUserFromOAuth({
      email,
      name: session.user.name,
    });
    if (linked?.active) {
      const billing = linked.studentId ? await syncStudentBilling(linked.studentId) : null;
      return {
        data: {
          kind: "member" as const,
          user: {
            id: linked.id,
            name: linked.name,
            email: linked.email,
            role: linked.role,
            studentId: linked.studentId,
            ...(billing ? { billing } : {}),
          },
        },
      };
    }

    return {
      data: {
        kind: "lead" as const,
        name: session.user.name || email.split("@")[0],
        email,
      },
    };
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
