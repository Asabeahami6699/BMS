-- Multiple tenure/rate options per investment product (061)

alter table public.investment_products
  add column if not exists rate_tiers jsonb not null default '[]'::jsonb;

comment on column public.investment_products.rate_tiers is
  'Array of { tenureDays, ratePercent, label?, sortOrder? } tiers for this product.';
