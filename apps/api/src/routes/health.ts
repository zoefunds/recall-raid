import type { FastifyInstance } from "fastify";
import { pool } from "../lib/db.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (_req, reply) => {
    try {
      await pool.query("select 1");
      return reply.send({ status: "ok", db: "ok" });
    } catch (err) {
      app.log.error(err, "health check: database unreachable");
      return reply.code(503).send({ status: "degraded", db: "unreachable" });
    }
  });
}
