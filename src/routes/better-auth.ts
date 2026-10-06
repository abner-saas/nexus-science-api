import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import { auth, googleAuthEnabled } from "../lib/better-auth.js";

export async function betterAuthRoutes(fastify: FastifyInstance) {
  fastify.get("/auth/providers", async () => ({
    data: { google: googleAuthEnabled() },
  }));

  fastify.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    async handler(request, reply) {
      const url = new URL(request.url, `${request.protocol}://${request.headers.host}`);
      const headers = fromNodeHeaders(request.headers);
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const response = await auth.handler(req);
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") return;
        reply.header(key, value);
      });
      // Headers.forEach collapses multiple Set-Cookie values. The Expo client
      // stores every one of them, so forward the list the same way /auth/login does.
      const setCookies = response.headers.getSetCookie?.() ?? [];
      if (setCookies.length > 0) reply.header("set-cookie", setCookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
