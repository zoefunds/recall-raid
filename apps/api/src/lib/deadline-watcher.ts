import type { FastifyBaseLogger } from "fastify";
import { pool } from "./db.js";
import { getTransactionStatus, chain } from "./genlayer.js";
import { canTransition, isTerminal, type TxStatus } from "./tx-status-machine.js";
import { syncInvestigation, syncSellerBond } from "./sync.js";

// 20s default: tight enough that a third-party viewer's stale window is
// barely noticeable, still cheap since these are read-only view calls
// against a small number of non-terminal investigations at this scale.
// Override via DEADLINE_WATCHER_INTERVAL_MS if the investigation count
// grows enough that this needs to back off.
const POLL_INTERVAL_MS = Number(process.env.DEADLINE_WATCHER_INTERVAL_MS ?? 20_000);

// Maps a GenVM transaction receipt status to our own tx_status_log enum.
// GenVM statuses observed in sibling projects: PENDING, ACCEPTED, FINALIZED,
// UNDETERMINED, CANCELED. We collapse ACCEPTED/FINALIZED to "confirmed" and
// UNDETERMINED/CANCELED to "failed" — this backend only mirrors outcomes, it
// never re-drives consensus.
function mapChainStatusToTxStatus(chainStatus: string | undefined): TxStatus | null {
  switch ((chainStatus ?? "").toUpperCase()) {
    case "PENDING":
      return "pending";
    case "ACCEPTED":
    case "FINALIZED":
      return "confirmed";
    case "UNDETERMINED":
    case "CANCELED":
    case "CANCELLED":
      return "failed";
    default:
      return null;
  }
}

/**
 * Two read-only background jobs, both consistent with this API's hard
 * "never signs a transaction" rule:
 *
 *  1. Poll every non-terminal tx_status_log row against the chain's own
 *     receipt and mirror the outcome — this is what lets a user close their
 *     laptop mid-transaction and still see the right status when they come
 *     back, without the API ever needing to submit anything itself.
 *  2. Sweep investigations_cache for evidence/verdict/challenge deadlines
 *     that are approaching or have just passed, and push a notification —
 *     purely informational (e.g. "your evidence window closes in 2 hours");
 *     the actual claim_*_timeout call is still signed and sent by a wallet.
 */
export function startDeadlineWatcher(logger: FastifyBaseLogger): void {
  async function pollPendingTransactions() {
    const { rows } = await pool.query(
      `select tx_hash, status from tx_status_log where status in ('submitted', 'pending')`,
    );
    for (const row of rows as { tx_hash: string; status: TxStatus }[]) {
      try {
        const receipt = await getTransactionStatus(row.tx_hash);
        const nextStatus = mapChainStatusToTxStatus((receipt as { status?: string } | null)?.status);
        if (!nextStatus || !canTransition(row.status, nextStatus) || nextStatus === row.status) continue;
        await pool.query(
          `update tx_status_log set status = $2, updated_at = now() where tx_hash = $1`,
          [row.tx_hash, nextStatus],
        );
        logger.info({ txHash: row.tx_hash, from: row.status, to: nextStatus }, "deadline-watcher: tx status updated");
      } catch (err) {
        logger.warn({ err, txHash: row.tx_hash }, "deadline-watcher: failed to poll tx receipt this tick");
      }
    }

    // Anything "submitted"/"pending" for over an hour with no confirmation
    // is treated as timed out client-side bookkeeping, not a chain fact —
    // it just stops the UI from polling a dead transaction forever.
    await pool.query(
      `update tx_status_log
       set status = 'timeout', updated_at = now()
       where status in ('submitted', 'pending') and created_at < now() - interval '1 hour'`,
    );
  }

  async function sweepDeadlineNotifications() {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const soonSeconds = nowSeconds + 3600; // notify once a deadline is within 1 hour

    const { rows: cached } = await pool.query(
      `select investigation_id, submitter_wallet, status, evidence_deadline, verdict_deadline, challenge_deadline
       from investigations_cache
       where status not in ('SETTLED', 'CANCELLED', 'INVALID')`,
    );

    for (const inv of cached as {
      investigation_id: number;
      submitter_wallet: string | null;
      status: string;
      evidence_deadline: number | null;
      verdict_deadline: number | null;
      challenge_deadline: number | null;
    }[]) {
      const deadlineChecks: { field: keyof typeof inv; type: string }[] = [
        { field: "evidence_deadline", type: "evidence_deadline_approaching" },
        { field: "verdict_deadline", type: "verdict_deadline_approaching" },
        { field: "challenge_deadline", type: "challenge_deadline_approaching" },
      ];
      for (const check of deadlineChecks) {
        const deadline = inv[check.field] as number | null;
        if (!deadline || deadline <= nowSeconds || deadline > soonSeconds || !inv.submitter_wallet) continue;

        const { rows: existing } = await pool.query(
          `select 1 from notifications
           where wallet_address = $1 and type = $2 and payload->>'investigation_id' = $3
           limit 1`,
          [inv.submitter_wallet, check.type, String(inv.investigation_id)],
        );
        if (existing.length > 0) continue;

        await pool.query(
          `insert into notifications (wallet_address, type, payload, read)
           values ($1, $2, $3::jsonb, false)`,
          [
            inv.submitter_wallet,
            check.type,
            JSON.stringify({ investigation_id: inv.investigation_id, deadline }),
          ],
        );
      }
    }
  }

  // Defense-in-depth against stale reads: the frontend syncs a row
  // immediately after ITS OWN transaction confirms (see apps/web's
  // syncInvestigation/syncSellerBond calls), but that only refreshes the
  // cache for the browser that acted. Anyone else viewing the same
  // investigation — a different wallet, a page loaded before the write
  // happened — would otherwise see a stale row until they happen to
  // trigger their own sync. This sweep re-pulls every investigation still
  // in a non-terminal state (and any seller bond linked to one) from chain
  // on every tick, so the cache self-heals within one poll interval
  // regardless of who caused the change or whether their sync call
  // actually landed (closed tab, network blip, etc).
  async function resyncActiveOnChainState() {
    const { rows: activeInvestigations } = await pool.query(
      `select investigation_id from investigations_cache where status not in ('SETTLED', 'CANCELLED', 'INVALID')`,
    );
    for (const row of activeInvestigations as { investigation_id: number }[]) {
      try {
        await syncInvestigation(row.investigation_id);
      } catch (err) {
        logger.warn({ err, investigationId: row.investigation_id }, "deadline-watcher: failed to resync investigation this tick");
      }
    }

    const { rows: activeBonds } = await pool.query(
      `select bond_id from seller_bonds_cache where status = 'ACTIVE' and linked_investigation_count > 0`,
    );
    for (const row of activeBonds as { bond_id: number }[]) {
      try {
        await syncSellerBond(row.bond_id);
      } catch (err) {
        logger.warn({ err, bondId: row.bond_id }, "deadline-watcher: failed to resync seller bond this tick");
      }
    }
  }

  async function tick() {
    try {
      await pollPendingTransactions();
    } catch (err) {
      logger.warn({ err }, "deadline-watcher: pollPendingTransactions failed this tick");
    }
    try {
      await resyncActiveOnChainState();
    } catch (err) {
      logger.warn({ err }, "deadline-watcher: resyncActiveOnChainState failed this tick");
    }
    try {
      await sweepDeadlineNotifications();
    } catch (err) {
      logger.warn({ err }, "deadline-watcher: sweepDeadlineNotifications failed this tick");
    }
  }

  logger.info({ intervalMs: POLL_INTERVAL_MS }, "deadline-watcher: starting (read-only, never signs transactions)");
  void tick();
  setInterval(() => void tick(), POLL_INTERVAL_MS);
}

// Re-exported for tests / lint clarity that this module never imports a
// signer type.
export { chain as _chainViewsUsedForPolling };
