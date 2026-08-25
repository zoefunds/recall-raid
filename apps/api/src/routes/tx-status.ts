import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { requireAuth } from "../plugins/auth-plugin.js";
import { TX_KINDS, TX_STATUSES, canTransition, isValidTxKind, isValidTxStatus, type TxStatus } from "../lib/tx-status-machine.js";
import { badRequest, notFound } from "../lib/http-errors.js";

const ReportSchema = z.object({
  txHash: z.string().min(4),
  kind: z.enum(TX_KINDS as unknown as [string, ...string[]]),
  status: z.enum(TX_STATUSES as unknown as [string, ...string[]]),
  relatedInvestigationId: z.number().int().positive().optional(),
});

export async function txStatusRoutes(app: FastifyInstance) {
  // The client reports each step of its own wallet-signed transaction
  // lifecycle here (preparing -> submitted -> pending -> confirmed/failed).
  // This is bookkeeping only — the API never derives this status from a
  // signature or submission it performed itself.
  app.post(
    "/tx-status",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const session = requireAuth(req);
      const parsed = ReportSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest(parsed.error.message);
      const { txHash, kind, status, relatedInvestigationId } = parsed.data;
      if (!isValidTxKind(kind) || !isValidTxStatus(status)) throw badRequest("invalid kind or status");

      const { rows: existingRows } = await pool.query("select status from tx_status_log where tx_hash = $1", [txHash]);
      const existing = existingRows[0] as { status: TxStatus } | undefined;

      if (existing && !canTransition(existing.status, status)) {
        throw badRequest(`illegal tx status transition: ${existing.status} -> ${status}`);
      }

      const { rows } = await pool.query(
        `insert into tx_status_log (tx_hash, wallet_address, kind, status, related_investigation_id, created_at, updated_at)
         values ($1, $2, $3, $4, $5, now(), now())
         on conflict (tx_hash) do update set
           status = excluded.status,
           related_investigation_id = coalesce(excluded.related_investigation_id, tx_status_log.related_investigation_id),
           updated_at = now()
         returning *`,
        [txHash, session.walletAddress, kind, status, relatedInvestigationId ?? null],
      );
      return reply.code(existing ? 200 : 201).send({ entry: rows[0] });
    },
  );

  app.get("/tx-status/:hash", async (req, reply) => {
    const hash = (req.params as { hash: string }).hash;
    const { rows } = await pool.query("select * from tx_status_log where tx_hash = $1", [hash]);
    if (rows.length === 0) throw notFound(`no tx-status entry for ${hash}`);
    return reply.send({ entry: rows[0] });
  });

  app.get("/tx-status", async (req, reply) => {
    const session = requireAuth(req);
    const { rows } = await pool.query(
      "select * from tx_status_log where wallet_address = $1 order by created_at desc limit 100",
      [session.walletAddress],
    );
    return reply.send({ items: rows });
  });
}
