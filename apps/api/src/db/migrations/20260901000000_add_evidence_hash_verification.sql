-- verify_evidence was strengthened to fetch raw bytes and cryptographically
-- confirm sha256(fetched bytes) == the submitter's claimed content_hash,
-- not just check the URL is reachable. This column was missed in the
-- original 20260831000000 migration when content_hash_verified was added
-- to the contract's Evidence struct — mirror it into the cache now so the
-- API/frontend can actually expose it instead of silently omitting it.
alter table evidence_cache add column if not exists content_hash_verified boolean not null default false;
