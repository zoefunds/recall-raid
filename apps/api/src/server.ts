import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { config } from "./lib/config.js";
import { attachAuthContext } from "./plugins/auth-plugin.js";
import { ApiError } from "./lib/http-errors.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { investigationRoutes } from "./routes/investigations.js";
import { evidenceRoutes } from "./routes/evidence.js";
import { challengeRoutes } from "./routes/challenges.js";
import { sellerBondRoutes } from "./routes/seller-bonds.js";
import { reputationRoutes } from "./routes/reputation.js";
import { notificationRoutes } from "./routes/notifications.js";
import { txStatusRoutes } from "./routes/tx-status.js";
import { statsRoutes } from "./routes/stats.js";
import { startDeadlineWatcher } from "./lib/deadline-watcher.js";

async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport: config.env === "development" ? { target: "pino-pretty" } : undefined,
    },
    trustProxy: true, // required behind Fly.io's edge proxy for correct client IPs
  });

  await app.register(cors, {
    origin: config.corsAllowedOrigin,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  });
  await app.register(cookie);

  // Baseline abuse/spam protection. Individual write endpoints (auth,
  // upload-url, tx-status POST, sync endpoints) additionally set their own
  // tighter per-route limits via `config.rateLimit` in their route options.
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
  });

  // Applied directly (not via app.register) so the session decorator/hook
  // apply across the whole app, including routes registered after this call.
  attachAuthContext(app);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(investigationRoutes);
  await app.register(evidenceRoutes);
  await app.register(challengeRoutes);
  await app.register(sellerBondRoutes);
  await app.register(reputationRoutes);
  await app.register(notificationRoutes);
  await app.register(txStatusRoutes);
  await app.register(statsRoutes);

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    // Full detail (stack trace, message) is only ever logged server-side —
    // the client response is a stable, minimal {error:{code,message}} shape.
    app.log.error(err);
    const statusCode = err.statusCode ?? 500;
    const code = err instanceof ApiError ? err.code : statusCode === 500 ? "internal_server_error" : "error";
    const message = statusCode === 500 ? "Internal server error" : err.message;
    reply.code(statusCode).send({ error: { code, message } });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: { code: "not_found", message: "Route not found" } });
  });

  return app;
}

async function main() {
  const app = await buildServer();

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down gracefully`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    startDeadlineWatcher(app.log);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
