-- Branch vault fields for Susu daily closing (Susu-only cash-to-bank; no Treasury post yet).

alter table public.susu_daily_closing_records
  add column if not exists opening_vault numeric(14, 2),
  add column if not exists cash_to_bank numeric(14, 2) not null default 0,
  add column if not exists closing_vault_counted numeric(14, 2);

comment on column public.susu_daily_closing_records.opening_vault is
  'Branch vault/safe opening for the day. When null on load, system suggests prior day closing vault.';
comment on column public.susu_daily_closing_records.cash_to_bank is
  'Cash remitted to bank for the day (Susu worksheet only; Banking Treasury post deferred).';
comment on column public.susu_daily_closing_records.closing_vault_counted is
  'Optional physical vault count at close. Used as next day suggested opening when set.';

comment on table public.susu_daily_closing_records is
  'Branch Susu vault day-close: opening vault, expenses, cash to bank, optional vault count.';
