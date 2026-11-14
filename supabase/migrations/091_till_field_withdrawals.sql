-- Track field-agent Pay-now withdrawals separately from walk-in till withdrawals
-- (same drawer cash; display/reporting split only).

alter table public.branch_float_sessions
  add column if not exists total_field_withdrawals numeric(14, 2) not null default 0;

comment on column public.branch_float_sessions.total_field_withdrawals is
  'Cash paid at till for coordinator-approved field-agent withdrawal requests (Pay now). Still included in total_withdrawals for expected cash.';
