-- Customer ID card type & Bank of Ghana Tier 1 Simplified KYC (Foreigner / No-ID with Local Introducer)
alter table public.customers
  add column if not exists id_card_type text,
  add column if not exists kyc_tier text not null default 'full',
  add column if not exists nationality text,
  add column if not exists kyc_introducer_name text,
  add column if not exists kyc_introducer_phone text,
  add column if not exists kyc_introducer_relationship text,
  add column if not exists kyc_introducer_ghana_card text,
  add column if not exists kyc_upgraded_at timestamptz;

comment on column public.customers.id_card_type is
  'ID document type: ghana_card, non_citizen_ghana_card, ecowas_id, voters_id, nhis, drivers_licence, passport, no_id_simplified_kyc.';
comment on column public.customers.kyc_tier is
  'BoG KYC tier: full (standard national/foreign ID) or simplified (Tier 1 Susu-only with local Ghana Card introducer).';
comment on column public.customers.kyc_introducer_ghana_card is
  'Ghana Card number of the local resident/introducer vouching for a Simplified KYC customer.';
