-- The contract's get_investigation view includes `description`, but the
-- initial cache schema omitted it (comment said "the contract already
-- stores it, no need to duplicate it") — that reasoning didn't account for
-- GET /investigations serving entirely from this cache without a per-row
-- chain read. Add it so the Active Hunts feed and investigation detail page
-- don't have to make an extra chain call per row just for description text.
alter table investigations_cache add column if not exists description text;
