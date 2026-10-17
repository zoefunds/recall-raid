-- A terminal GenLayer view must be paired with the exact successful,
-- finalized GenVM write receipt before the API authorizes Base settlement.
ALTER TABLE investigations_cache
  ADD COLUMN IF NOT EXISTS terminal_genvm_tx_hash text;

ALTER TABLE investigations_cache
  ADD COLUMN IF NOT EXISTS last_challenge_id integer;

ALTER TABLE investigations_cache
  ADD COLUMN IF NOT EXISTS challenge_used boolean;
