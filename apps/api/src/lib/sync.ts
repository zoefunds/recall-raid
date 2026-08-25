import { pool } from "./db.js";
import { chain } from "./genlayer.js";
import { investigationStatusLabel, verdictLabel, challengeStatusLabel, bondStatusLabel } from "./chain-enums.js";

/** Re-reads one investigation (and its evidence) from chain into Postgres. */
export async function syncInvestigation(investigationId: number): Promise<void> {
  const inv = await chain.getInvestigation(investigationId);

  await pool.query(
    `insert into investigations_cache (
       investigation_id, submitter_wallet, product_name, brand, model_number, serial_number,
       marketplace, marketplace_url, manufacturer_url, recall_source_url, category, hazard_class,
       status, verdict, bounty_wei, bounty_deposited_wei, seller_bond_id, ai_confidence_bps,
       hunter_payout_bps, evidence_count, created_at_chain, evidence_deadline, verdict_deadline,
       challenge_deadline, open_challenge_id, settled, description, search_keywords, synced_at
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
       to_tsvector('english', coalesce($3,'') || ' ' || coalesce($4,'') || ' ' || coalesce($11,'')),
       now()
     )
     on conflict (investigation_id) do update set
       submitter_wallet = excluded.submitter_wallet,
       product_name = excluded.product_name,
       brand = excluded.brand,
       model_number = excluded.model_number,
       serial_number = excluded.serial_number,
       marketplace = excluded.marketplace,
       marketplace_url = excluded.marketplace_url,
       manufacturer_url = excluded.manufacturer_url,
       recall_source_url = excluded.recall_source_url,
       category = excluded.category,
       hazard_class = excluded.hazard_class,
       status = excluded.status,
       verdict = excluded.verdict,
       bounty_wei = excluded.bounty_wei,
       bounty_deposited_wei = excluded.bounty_deposited_wei,
       seller_bond_id = excluded.seller_bond_id,
       ai_confidence_bps = excluded.ai_confidence_bps,
       hunter_payout_bps = excluded.hunter_payout_bps,
       evidence_count = excluded.evidence_count,
       evidence_deadline = excluded.evidence_deadline,
       verdict_deadline = excluded.verdict_deadline,
       challenge_deadline = excluded.challenge_deadline,
       open_challenge_id = excluded.open_challenge_id,
       settled = excluded.settled,
       description = excluded.description,
       search_keywords = excluded.search_keywords,
       synced_at = now()
    `,
    [
      inv.id,
      inv.submitter?.toLowerCase() ?? null,
      inv.product_name,
      inv.brand,
      inv.model_number,
      inv.serial_number,
      inv.marketplace,
      inv.marketplace_url,
      inv.manufacturer_url,
      inv.recall_source_url,
      inv.category,
      inv.hazard_class,
      investigationStatusLabel(inv.status),
      verdictLabel(inv.verdict),
      inv.bounty_wei,
      inv.bounty_deposited_wei,
      inv.seller_bond_id || null,
      inv.ai_confidence_bps,
      inv.hunter_payout_bps,
      inv.evidence_count,
      inv.created_at,
      inv.evidence_deadline,
      inv.verdict_deadline,
      inv.challenge_deadline,
      inv.open_challenge_id || null,
      inv.settled,
      inv.description,
    ],
  );

  // Ensure the submitter has a users row for the FK, in case they've never
  // logged in through /auth (e.g. this sync ran from a webhook/poller).
  if (inv.submitter) {
    await pool.query(
      `insert into users (wallet_address) values ($1) on conflict (wallet_address) do nothing`,
      [inv.submitter.toLowerCase()],
    );
  }

  const evidenceIds = await chain.getEvidenceIdsForInvestigation(investigationId);
  for (const evidenceId of evidenceIds) {
    await syncEvidence(evidenceId);
  }
}

export async function syncEvidence(evidenceId: number): Promise<void> {
  const ev = await chain.getEvidence(evidenceId);
  await pool.query(
    `insert into evidence_cache (
       evidence_id, investigation_id, submitter_wallet, evidence_type, content_hash, url,
       description, submitted_at_chain, synced_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8, now())
     on conflict (evidence_id) do update set
       investigation_id = excluded.investigation_id,
       submitter_wallet = excluded.submitter_wallet,
       evidence_type = excluded.evidence_type,
       content_hash = excluded.content_hash,
       url = excluded.url,
       description = excluded.description,
       submitted_at_chain = excluded.submitted_at_chain,
       synced_at = now()
    `,
    [
      ev.id,
      ev.investigation_id,
      ev.submitter?.toLowerCase() ?? null,
      ev.evidence_type,
      ev.content_hash,
      ev.url,
      ev.description,
      ev.submitted_at,
    ],
  );
}

export async function syncChallenge(challengeId: number): Promise<void> {
  const c = await chain.getChallenge(challengeId);
  await pool.query(
    `insert into challenges_cache (
       challenge_id, investigation_id, challenger_wallet, reason, stake_wei, stake_deposited_wei,
       status, created_at_chain, resolution_deadline, prior_verdict, new_verdict, synced_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
     on conflict (challenge_id) do update set
       investigation_id = excluded.investigation_id,
       challenger_wallet = excluded.challenger_wallet,
       reason = excluded.reason,
       stake_wei = excluded.stake_wei,
       stake_deposited_wei = excluded.stake_deposited_wei,
       status = excluded.status,
       created_at_chain = excluded.created_at_chain,
       resolution_deadline = excluded.resolution_deadline,
       prior_verdict = excluded.prior_verdict,
       new_verdict = excluded.new_verdict,
       synced_at = now()
    `,
    [
      c.id,
      c.investigation_id,
      c.challenger?.toLowerCase() ?? null,
      c.reason,
      c.stake_wei,
      c.stake_deposited_wei,
      challengeStatusLabel(c.status),
      c.created_at,
      c.resolution_deadline,
      verdictLabel(c.prior_verdict),
      verdictLabel(c.new_verdict),
    ],
  );
  // A challenge outcome always changes the parent investigation too.
  await syncInvestigation(c.investigation_id);
}

export async function syncSellerBond(bondId: number): Promise<void> {
  const bond = await chain.getSellerBond(bondId);
  await pool.query(
    `insert into users (wallet_address) values ($1) on conflict (wallet_address) do nothing`,
    [bond.seller.toLowerCase()],
  );
  await pool.query(
    `insert into seller_bonds_cache (
       bond_id, seller_wallet, bond_wei, bond_deposited_wei, status, created_at_chain,
       linked_investigation_count, slashed_total_wei, synced_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8, now())
     on conflict (bond_id) do update set
       seller_wallet = excluded.seller_wallet,
       bond_wei = excluded.bond_wei,
       bond_deposited_wei = excluded.bond_deposited_wei,
       status = excluded.status,
       created_at_chain = excluded.created_at_chain,
       linked_investigation_count = excluded.linked_investigation_count,
       slashed_total_wei = excluded.slashed_total_wei,
       synced_at = now()
    `,
    [
      bond.id,
      bond.seller.toLowerCase(),
      bond.bond_wei,
      bond.bond_deposited_wei,
      bondStatusLabel(bond.status),
      bond.created_at,
      bond.linked_investigation_count,
      bond.slashed_total_wei,
    ],
  );
}

/** Rebuilds the leaderboard cache from on-chain get_reputation calls for a known set of wallets. */
export async function refreshLeaderboardFor(wallets: string[]): Promise<void> {
  const rows: {
    wallet: string;
    valid_discoveries: number;
    invalid_reports: number;
    successful_challenges: number;
    failed_challenges: number;
    accuracy_bps: number;
    total_earned_wei: string;
  }[] = [];

  for (const wallet of wallets) {
    const rep = await chain.getReputation(wallet);
    rows.push({
      wallet: wallet.toLowerCase(),
      valid_discoveries: rep.valid_discoveries,
      invalid_reports: rep.invalid_reports,
      successful_challenges: rep.successful_challenges,
      failed_challenges: rep.failed_challenges,
      accuracy_bps: rep.accuracy_bps,
      total_earned_wei: rep.total_earned_wei,
    });
  }

  rows.sort((a, b) => (BigInt(b.total_earned_wei) > BigInt(a.total_earned_wei) ? 1 : -1));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    await pool.query(
      `insert into leaderboard_cache (
         wallet_address, valid_discoveries, invalid_reports, successful_challenges,
         failed_challenges, accuracy_bps, total_earned_wei, rank, refreshed_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8, now())
       on conflict (wallet_address) do update set
         valid_discoveries = excluded.valid_discoveries,
         invalid_reports = excluded.invalid_reports,
         successful_challenges = excluded.successful_challenges,
         failed_challenges = excluded.failed_challenges,
         accuracy_bps = excluded.accuracy_bps,
         total_earned_wei = excluded.total_earned_wei,
         rank = excluded.rank,
         refreshed_at = now()
      `,
      [
        r.wallet,
        r.valid_discoveries,
        r.invalid_reports,
        r.successful_challenges,
        r.failed_challenges,
        r.accuracy_bps,
        r.total_earned_wei,
        i + 1,
      ],
    );
  }
}
