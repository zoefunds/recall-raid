import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { generateSignedUpload, UploadValidationError } from "../lib/cloudinary.js";
import { syncInvestigation } from "../lib/sync.js";
import { requireAuth } from "../plugins/auth-plugin.js";
import { badRequest } from "../lib/http-errors.js";
import { serializeEvidence, type EvidenceRow } from "../lib/serialize.js";

const UploadUrlSchema = z.object({
  investigationId: z.coerce.number().int().positive(),
  contentType: z.string(),
  declaredSizeBytes: z.coerce.number().int().positive(),
  fileName: z.string().optional(),
});

const SyncSchema = z.object({ txHash: z.string().optional() });

const ListQuerySchema = z.object({
  investigation_id: z.coerce.number().int().positive(),
});

export async function evidenceRoutes(app: FastifyInstance) {
  // GET /evidence?investigation_id=N — served from the Postgres cache,
  // mirroring the read pattern already used by GET /investigations.
  // Powers the evidence gallery on the investigation detail page.
  app.get("/evidence", async (req, reply) => {
    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest(parsed.error.message);

    const { rows } = await pool.query(
      "select * from evidence_cache where investigation_id = $1 order by submitted_at_chain asc",
      [parsed.data.investigation_id],
    );
    return reply.send((rows as EvidenceRow[]).map(serializeEvidence));
  });

  // Issues a Cloudinary SIGNED upload (api_key/timestamp/signature/public_id
  // fields, never the file itself) so the frontend uploads the evidence file
  // directly to Cloudinary as a multipart POST — this API never proxies the
  // bytes. Cloudinary's own upload response carries the final `secure_url`,
  // which the frontend then passes to the on-chain add_evidence(url=...)
  // call and reports back via /evidence/:investigationId/sync.
  app.post(
    "/evidence/upload-url",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const session = requireAuth(req);
      const parsed = UploadUrlSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest(parsed.error.message);

      try {
        const upload = generateSignedUpload(parsed.data);
        // The on-chain evidence_id doesn't exist yet (add_evidence hasn't
        // been broadcast) — stage the object metadata keyed by
        // (investigation, wallet) so /evidence/:id/sync can attach it to
        // the real evidence_cache row once the id is known. The
        // `r2_object_key` column predates the Cloudinary swap and is kept
        // as-is (avoiding a rename migration) — it now holds
        // `<cloudinary folder>/<public_id>`, Cloudinary's equivalent of an
        // object key.
        await pool.query(
          `insert into evidence_uploads_pending (investigation_id, submitter_wallet, r2_object_key, mime_type, file_size_bytes)
           values ($1, $2, $3, $4, $5)`,
          [
            parsed.data.investigationId,
            session.walletAddress,
            `${upload.fields.folder}/${upload.publicId}`,
            parsed.data.contentType,
            parsed.data.declaredSizeBytes,
          ],
        );
        return reply.send({ upload_url: upload.uploadUrl, fields: upload.fields, public_id: upload.publicId });
      } catch (err) {
        if (err instanceof UploadValidationError) throw badRequest(err.message);
        throw err;
      }
    },
  );

  // Re-reads evidence for an investigation from chain after a client-signed
  // add_evidence transaction confirms.
  app.post(
    "/evidence/:investigationId/sync",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      requireAuth(req);
      const investigationId = Number((req.params as { investigationId: string }).investigationId);
      if (!Number.isInteger(investigationId) || investigationId <= 0) throw badRequest("investigationId must be a positive integer");
      const parsed = SyncSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw badRequest(parsed.error.message);

      await syncInvestigation(investigationId);

      if (parsed.data.txHash) {
        await pool.query(
          `update tx_status_log set related_investigation_id = $2, updated_at = now() where tx_hash = $1`,
          [parsed.data.txHash, investigationId],
        );
      }

      // Backfill R2 metadata onto whichever synced evidence rows don't have
      // it yet, matching the most recent unconsumed pending upload per
      // submitter — best-effort: if a submitter attached a URL evidence item
      // with no upload, there's simply nothing to match and this is a no-op.
      const { rows: unmatched } = await pool.query(
        `select evidence_id, submitter_wallet from evidence_cache
         where investigation_id = $1 and r2_object_key is null`,
        [investigationId],
      );
      for (const row of unmatched as { evidence_id: number; submitter_wallet: string | null }[]) {
        if (!row.submitter_wallet) continue;
        const { rows: pending } = await pool.query(
          `select id, r2_object_key, mime_type, file_size_bytes from evidence_uploads_pending
           where investigation_id = $1 and submitter_wallet = $2 and consumed = false
           order by created_at desc limit 1`,
          [investigationId, row.submitter_wallet],
        );
        if (pending.length === 0) continue;
        const p = pending[0];
        await pool.query(
          `update evidence_cache set r2_object_key = $2, mime_type = $3, file_size_bytes = $4 where evidence_id = $1`,
          [row.evidence_id, p.r2_object_key, p.mime_type, p.file_size_bytes],
        );
        await pool.query(`update evidence_uploads_pending set consumed = true where id = $1`, [p.id]);
      }

      const { rows } = await pool.query(
        "select * from evidence_cache where investigation_id = $1 order by submitted_at_chain asc",
        [investigationId],
      );
      return reply.send({ evidence: rows });
    },
  );
}
