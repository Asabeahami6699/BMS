-- Per-company savings opening amount. Default matches the previous fixed GHS 20.

alter table public.tenants
  add column if not exists savings_opening_fee_ghs numeric(12, 2) not null default 20;
