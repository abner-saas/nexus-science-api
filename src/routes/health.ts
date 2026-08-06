import type { FastifyInstance } from "fastify";

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", async () => ({
    status: "ok",
    service: "nexus-science-api",
    timestamp: new Date().toISOString(),
  }));
}
