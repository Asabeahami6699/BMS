-- ID card photo + savings opening fee collection tracking.

alter table public.customers
  add column if not exists id_card_photo_url text,
  add column if not exists savings_opening_fee_collected boolean not null default false,
  add column if not exists savings_opening_fee_recovered numeric(12,2) not null default 0;
