-- RecallRaid API — initial schema.
--
-- This database is a READ-CACHE + off-chain-session-data store. On-chain
-- state (contracts/recallraid_contract.py) is the source of truth for
-- money, verdicts, and evidence hashes; nothing here is authoritative for
-- those. Full field lists intentionally mirror the contract's
-- *_to_dict() view shapes so a row here can be rebuilt from a single
-- get_investigation/get_evidence/... call at any time.

create table users (
  wallet_address text primary key,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Challenge/nonce/signature wallet-auth flow. One live nonce per wallet at
-- a time (re-requesting /auth/nonce simply replaces it) — see src/lib/auth.ts.
create table login_nonces (
  wallet_address text primary key references users(wallet_address) on delete cascade,
  nonce text not null,
  expires_at timestamptz not null,
  used boolean not null default false
);

create table investigations_cache (
  investigation_id integer primary key,
  submitter_wallet text references users(wallet_address),
  product_name text not null,
  brand text not null,
  model_number text,
  serial_number text,
  marketplace text,
  marketplace_url text,
  manufacturer_url text,
  recall_source_url text,
  category text,
  hazard_class smallint,
  status text not null,
  verdict text,
  bounty_wei numeric(78, 0),
  bounty_deposited_wei numeric(78, 0),
  seller_bond_id integer,
  ai_confidence_bps integer,
  hunter_payout_bps integer,
  evidence_count integer not null default 0,
  created_at_chain bigint,
  evidence_deadline bigint,
  verdict_deadline bigint,
  challenge_deadline bigint,
  open_challenge_id integer,
  settled boolean not null default false,
  -- Off-chain-only fields: the contract already stores the full
  -- description, so it is not duplicated here — only search/indexing and
  -- our own bookkeeping live in this table.
  search_keywords tsvector,
  submit_tx_hash text,
  synced_at timestamptz not null default now()
);

create index investigations_cache_status_idx on investigations_cache (status);
create index investigations_cache_category_idx on investigations_cache (category);
create index investigations_cache_hazard_class_idx on investigations_cache (hazard_class);
create index investigations_cache_created_at_idx on investigations_cache (created_at_chain desc);
create index investigations_cache_search_idx on investigations_cache using gin (search_keywords);

create table evidence_cache (
  evidence_id integer primary key,
  investigation_id integer not null references investigations_cache(investigation_id) on delete cascade,
  submitter_wallet text,
  evidence_type text,
  content_hash text,
  url text,
  description text,
  submitted_at_chain bigint,
  -- Off-chain-only: R2 object metadata for evidence files uploaded via
  -- /evidence/upload-url. `url` above is the on-chain reference (may be the
  -- same R2 public URL, or an external manufacturer/marketplace link).
  r2_object_key text,
  mime_type text,
  file_size_bytes integer,
  synced_at timestamptz not null default now()
);

create index evidence_cache_investigation_idx on evidence_cache (investigation_id);

-- Staging row created by POST /evidence/upload-url, before the caller has
-- actually broadcast add_evidence (and therefore before an on-chain
-- evidence_id exists to key evidence_cache by). /evidence/:id/sync matches
-- the most recent unconsumed row for (investigation_id, submitter_wallet)
-- to backfill r2_object_key/mime_type/file_size_bytes onto the newly
-- synced evidence_cache row.
create table evidence_uploads_pending (
  id bigserial primary key,
  investigation_id integer not null,
  submitter_wallet text not null,
  r2_object_key text not null,
  mime_type text not null,
  file_size_bytes integer not null,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);

create index evidence_uploads_pending_lookup_idx
  on evidence_uploads_pending (investigation_id, submitter_wallet, consumed, created_at desc);

create table challenges_cache (
  challenge_id integer primary key,
  investigation_id integer not null references investigations_cache(investigation_id) on delete cascade,
  challenger_wallet text,
  reason text,
  stake_wei numeric(78, 0),
  stake_deposited_wei numeric(78, 0),
  status text not null,
  created_at_chain bigint,
  resolution_deadline bigint,
  prior_verdict text,
  new_verdict text,
  open_tx_hash text,
  synced_at timestamptz not null default now()
);

create index challenges_cache_investigation_idx on challenges_cache (investigation_id);
create index challenges_cache_status_idx on challenges_cache (status);

create table seller_bonds_cache (
  bond_id integer primary key,
  seller_wallet text references users(wallet_address),
  bond_wei numeric(78, 0),
  bond_deposited_wei numeric(78, 0),
  status text not null,
  created_at_chain bigint,
  linked_investigation_count integer not null default 0,
  slashed_total_wei numeric(78, 0),
  synced_at timestamptz not null default now()
);

create index seller_bonds_cache_seller_idx on seller_bonds_cache (seller_wallet);

create table notifications (
  id bigserial primary key,
  wallet_address text not null references users(wallet_address) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_wallet_idx on notifications (wallet_address, created_at desc);
create index notifications_unread_idx on notifications (wallet_address) where read = false;

create table tx_status_log (
  tx_hash text primary key,
  wallet_address text references users(wallet_address),
  kind text not null,
  status text not null default 'idle',
  related_investigation_id integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tx_status_log_wallet_idx on tx_status_log (wallet_address, created_at desc);
create index tx_status_log_status_idx on tx_status_log (status);
create index tx_status_log_investigation_idx on tx_status_log (related_investigation_id);

create table leaderboard_cache (
  wallet_address text primary key references users(wallet_address) on delete cascade,
  valid_discoveries integer not null default 0,
  invalid_reports integer not null default 0,
  successful_challenges integer not null default 0,
  failed_challenges integer not null default 0,
  accuracy_bps integer not null default 0,
  total_earned_wei numeric(78, 0) not null default 0,
  rank integer,
  refreshed_at timestamptz not null default now()
);

create index leaderboard_cache_rank_idx on leaderboard_cache (rank);
create index leaderboard_cache_earned_idx on leaderboard_cache (total_earned_wei desc);
