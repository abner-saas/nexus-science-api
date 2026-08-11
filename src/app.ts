import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { env } from "./lib/env.js";
import { authPlugin } from "./plugins/auth.js";
import { assessmentsRoutes } from "./routes/assessments.js";
import { authRoutes } from "./routes/auth.js";
import { biofeedbackRoutes } from "./routes/biofeedback.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { financeRoutes } from "./routes/finance.js";
import { healthRoutes } from "./routes/health.js";
import { plansRoutes } from "./routes/plans.js";
import { aiInsightsRoutes, retentionRoutes } from "./routes/retention.js";
import { studentsRoutes } from "./routes/students.js";
import { trainingRoutes } from "./routes/training.js";
import { usersRoutes } from "./routes/users.js";
import { asaasWebhookRoutes } from "./routes/webhooks.asaas.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      transport:
        env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
    trustProxy: true,
    bodyLimit: 1048576,
  });

  await app.register(sensible);

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: env.NODE_ENV === "production",
  });

  const origins = env.CORS_ORIGIN.split(",").map((o) => o.trim());
  await app.register(cors, {
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: "1 minute",
    // Behind Cloudflare + Caddy, request.ip resolves to whichever Cloudflare edge
    // node handled the connection (it rotates), not the real visitor — that makes
    // per-IP limiting meaningless. cf-connecting-ip is Cloudflare's own header for
    // the true client IP. NOTE: this is spoofable if the origin is ever reachable
    // directly (bypassing Cloudflare) — the VPS firewall must restrict inbound
    // 80/443 to Cloudflare's published IP ranges for this header to be trustworthy.
    // TODO: not yet enforced — see DEPLOY.md "Firewall (UFW)".
    keyGenerator: (request) => (request.headers["cf-connecting-ip"] as string) || request.ip,
  });

  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(studentsRoutes);
  await app.register(dashboardRoutes);
  await app.register(plansRoutes);
  await app.register(trainingRoutes);
  await app.register(biofeedbackRoutes);
  await app.register(financeRoutes);
  await app.register(assessmentsRoutes);
  await app.register(retentionRoutes);
  await app.register(aiInsightsRoutes);
  await app.register(usersRoutes);
  await app.register(asaasWebhookRoutes);

  app.setErrorHandler((error, _request, reply) => {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode ?? 500;
    if (statusCode >= 500) {
      app.log.error(err);
    }
    reply.status(statusCode).send({
      error: err.name || "Error",
      message: statusCode >= 500 ? "Erro interno do servidor" : err.message,
    });
  });

  return app;
}
