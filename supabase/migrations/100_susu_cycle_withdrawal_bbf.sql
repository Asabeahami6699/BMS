-- Track per-page withdrawal settlement, red-line cancellation, and Balance Brought Forward (BBF)
-- on Susu customer cycles so FIFO withdrawal commission never double-charges completed pages
-- and leftover balance from broken/cancelled pages carries onto the next fresh card without
-- auto-checking boxes.

alter table public.susu_customer_cycles
  add column if not exists withdrawn_amount numeric(18, 2) not null default 0 check (withdrawn_amount >= 0),
  add column if not exists balance_brought_forward numeric(18, 2) not null default 0 check (balance_brought_forward >= 0),
  add column if not exists bbf_withdrawn numeric(18, 2) not null default 0 check (bbf_withdrawn >= 0),
  add column if not exists cancelled_at timestamptz;

comment on column public.susu_customer_cycles.withdrawn_amount is
  'Withdrawal principal settled from this page via FIFO.';
comment on column public.susu_customer_cycles.balance_brought_forward is
  'Leftover savings carried into this new card from previous cancelled/settled pages (does not auto-check boxes).';
comment on column public.susu_customer_cycles.bbf_withdrawn is
  'Portion of balance_brought_forward already spent on subsequent withdrawals (0 extra fee).';
comment on column public.susu_customer_cycles.cancelled_at is
  'Timestamp when this Susu page was settled/broken and crossed out (red line).';
