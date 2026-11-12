-- Loan qualification setup, Susu disbursement credit, passbook lien, auto-debit recovery

alter table public.tenants
  add column if not exists loan_qualification_config jsonb;

comment on column public.tenants.loan_qualification_config is
  'Tenant loan qualification rules when Susu↔Loans bridge is active (period, thresholds, collateral %).';

alter table public.customers
  add column if not exists loan_collateral_locked numeric(14, 2) not null default 0,
  add column if not exists loan_qualified_at timestamptz,
  add column if not exists loan_qualification_notified_at timestamptz,
  add column if not exists loan_qualification_badge text;

comment on column public.customers.loan_collateral_locked is
  'Passbook lien amount held on Susu/savings while a bridge loan is open.';
comment on column public.customers.loan_qualified_at is
  'When the customer last met tenant loan qualification rules.';
comment on column public.customers.loan_qualification_notified_at is
  'When the customer was last SMS-notified that they qualify for a loan.';
comment on column public.customers.loan_qualification_badge is
  'Display badge label when qualified (e.g. Loan ready).';

alter table public.loan_applications
  add column if not exists collateral_lien_amount numeric(14, 2) not null default 0,
  add column if not exists disburse_to_susu boolean not null default true,
  add column if not exists susu_disbursement_transaction_id text,
  add column if not exists auto_debit_fail_count integer not null default 0,
  add column if not exists auto_debit_last_failed_at timestamptz,
  add column if not exists auto_debit_recovery_stage text
    check (auto_debit_recovery_stage is null or auto_debit_recovery_stage in (
      'retry_pending', 'sms_sent', 'agent_task', 'par_escalated'
    )),
  add column if not exists par_escalated_at timestamptz;

comment on column public.loan_applications.collateral_lien_amount is
  'Susu/savings amount locked as passbook collateral for this loan.';
comment on column public.loan_applications.disburse_to_susu is
  'When true and bridge is on, principal is credited to the customer Susu ledger on disbursement.';
comment on column public.loan_applications.auto_debit_recovery_stage is
  'Missed Susu auto-debit recovery ladder stage.';

create table if not exists public.loan_auto_debit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants (id) on delete cascade,
  loan_id uuid not null references public.loan_applications (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  event_type text not null check (event_type in (
    'attempt', 'paid', 'failed', 'retry', 'sms', 'agent_task', 'par_escalated'
  )),
  amount numeric(14, 2) not null default 0,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists loan_auto_debit_events_loan_idx
  on public.loan_auto_debit_events (tenant_id, loan_id, created_at desc);

create index if not exists customers_loan_qualified_idx
  on public.customers (tenant_id, loan_qualified_at)
  where loan_qualified_at is not null;
