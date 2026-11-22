-- Scheduled daily Susu contribution rate change that takes effect on the customer's next Susu card/cycle
-- without mutating the active card's box amount.
alter table public.customers
  add column if not exists pending_daily_contribution_amount numeric(14, 2),
  add column if not exists pending_daily_contribution_set_at timestamptz,
  add column if not exists pending_daily_contribution_set_by text references public.users(id) on delete set null;

comment on column public.customers.pending_daily_contribution_amount is
  'Scheduled daily Susu contribution amount (GHS) that automatically activates when the next Susu card/cycle opens.';
comment on column public.customers.pending_daily_contribution_set_at is
  'Timestamp when the next-card daily Susu amount was scheduled.';
comment on column public.customers.pending_daily_contribution_set_by is
  'Office user who scheduled the next-card daily Susu amount.';
