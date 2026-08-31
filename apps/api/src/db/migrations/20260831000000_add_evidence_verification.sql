-- verify_evidence (contract) adds a real, GenVM-web-fetch-backed check of
-- whether an evidence URL is actually reachable, instead of trusting the
-- submitter's unchecked URL and client-supplied content_hash alone — mirror
-- the new fields into the cache so the frontend can show verification
-- status without a per-row chain read.
alter table evidence_cache add column if not exists url_checked boolean not null default false;
alter table evidence_cache add column if not exists url_reachable boolean not null default false;
alter table evidence_cache add column if not exists fetch_excerpt text;
alter table evidence_cache add column if not exists verified_at_chain bigint;
