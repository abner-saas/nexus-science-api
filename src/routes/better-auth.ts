import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
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
        reply.header(key, value);
      });
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
