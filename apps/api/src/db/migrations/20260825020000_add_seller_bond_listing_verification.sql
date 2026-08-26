-- verify_seller_bond_listing (contract) adds a real, GenVM-web-fetch-backed
-- proof that the bond owner controls a specific marketplace listing's page
-- content — mirror the new fields into the cache so the frontend can show
-- a "Verified Listing" badge without a per-row chain read.
alter table seller_bonds_cache add column if not exists verification_code text;
alter table seller_bonds_cache add column if not exists listing_url text;
alter table seller_bonds_cache add column if not exists listing_verified boolean not null default false;
