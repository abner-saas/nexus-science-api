import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { devicePushTokens } from "../db/schema.js";

const pushTokenBody = z.object({
  token: z.string().trim().min(1).max(512),
  platform: z.enum(["ios", "android"]),
});

export async function pushTokenRoutes(fastify: FastifyInstance) {
  fastify.post("/me/push-token", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const parsed = pushTokenBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ValidationError", issues: parsed.error.flatten() });
    }

    const now = new Date();
    await db
      .insert(devicePushTokens)
      .values({
        userId: request.user.sub,
        token: parsed.data.token,
        platform: parsed.data.platform,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: devicePushTokens.token,
        set: {
          userId: request.user.sub,
          platform: parsed.data.platform,
          lastSeenAt: now,
        },
      });

    return { ok: true };
  });
}
