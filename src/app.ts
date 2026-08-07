import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { env } from "./lib/env.js";
import { authPlugin } from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { studentsRoutes } from "./routes/students.js";
import { healthRoutes } from "./routes/health.js";
import { asaasWebhookRoutes } from "./routes/webhooks.asaas.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { plansRoutes } from "./routes/plans.js";
import { trainingRoutes } from "./routes/training.js";
import { biofeedbackRoutes } from "./routes/biofeedback.js";
import { financeRoutes } from "./routes/finance.js";
import { assessmentsRoutes } from "./routes/assessments.js";
import { retentionRoutes, aiInsightsRoutes } from "./routes/retention.js";
import { usersRoutes } from "./routes/users.js";

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
