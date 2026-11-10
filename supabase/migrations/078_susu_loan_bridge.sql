-- Susu ↔ Loans bridge (opt-in tenant setting + application snapshot + repayment source)

alter table public.tenants
  add column if not exists susu_loan_bridge_enabled boolean not null default false;

alter table public.loan_applications
  add column if not exists susu_credit_snapshot jsonb;

alter table public.loan_repayments
  add column if not exists payment_source text not null default 'cash'
    check (payment_source in ('cash', 'susu_account')),
  add column if not exists susu_transaction_id text;

comment on column public.tenants.susu_loan_bridge_enabled is
  'When true and both susu_management and loans_credit are subscribed, Susu can benchmark loans and fund repayments.';

comment on column public.loan_applications.susu_credit_snapshot is
  'Read-only Susu balance/activity snapshot captured at application time when the bridge is enabled.';

comment on column public.loan_repayments.payment_source is
  'cash = manual/cash repayment; susu_account = debited from customer Susu ledger via the bridge.';
