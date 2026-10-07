alter table investigations_cache add column if not exists base_case_id text not null default '';
alter table investigations_cache add column if not exists relay_tx_hash text not null default '';
alter table challenges_cache add column if not exists base_tx_hash text not null default '';
alter table seller_bonds_cache add column if not exists base_bond_id text not null default '';

create index if not exists investigations_cache_base_case_idx on investigations_cache (base_case_id);
