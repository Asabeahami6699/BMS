-- Callover cash shortages / overages as independent open cases (no day-to-day offsetting).
-- Shortage = agent owes office. Overage = unposted/miskeyed customer cash to reconcile.

create table if not exists public.field_agent_cash_variances (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  field_agent_id text not null,
  batch_id uuid not null references public.field_agent_collection_batches(id) on delete cascade,
  business_date date not null,
  branch_id text,
  variance_type text not null
    check (variance_type in ('shortage', 'overage')),
  batch_total numeric(12,2) not null,
  cash_received numeric(12,2) not null,
  variance_amount numeric(12,2) not null check (variance_amount > 0),
  outstanding_amount numeric(12,2) not null check (outstanding_amount >= 0),
  status text not null default 'open'
    check (status in ('open', 'partially_settled', 'settled', 'written_off')),
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (batch_id)
);

create table if not exists public.field_agent_cash_variance_settlements (
  id uuid primary key default gen_random_uuid(),
  variance_id uuid not null references public.field_agent_cash_variances(id) on delete cascade,
  tenant_id text not null,
  amount numeric(12,2) not null check (amount > 0),
  method text not null
    check (method in (
      'cash_repayment',
      'salary_deduction',
      'customer_correction',
      'write_off',
      'other'
    )),
  notes text,
  recorded_by text not null,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_cash_variances_tenant_status
  on public.field_agent_cash_variances (tenant_id, status, business_date desc);

create index if not exists idx_cash_variances_agent
  on public.field_agent_cash_variances (tenant_id, field_agent_id, status, business_date desc);

create index if not exists idx_cash_variance_settlements_variance
  on public.field_agent_cash_variance_settlements (variance_id, recorded_at desc);

alter table public.field_agent_cash_variances enable row level security;
alter table public.field_agent_cash_variance_settlements enable row level security;

create policy field_agent_cash_variances_select on public.field_agent_cash_variances
for select using (tenant_id = public.jwt_tenant_id());

create policy field_agent_cash_variance_settlements_select on public.field_agent_cash_variance_settlements
for select using (tenant_id = public.jwt_tenant_id());

alter table public.agent_notifications
  drop constraint if exists agent_notifications_kind_check;

alter table public.agent_notifications
  add constraint agent_notifications_kind_check
  check (
    kind in (
      'registration_approved',
      'registration_rejected',
      'registration_pending',
      'balance_disclosure_approved',
      'balance_disclosure_rejected',
      'balance_request_pending',
      'withdrawal_request_approved',
      'withdrawal_request_rejected',
      'withdrawal_request_pending',
      'withdrawal_momo_sent',
      'withdrawal_cs_approved',
      'withdrawal_ready_for_teller',
      'deposit_pending_bank',
      'deposit_pending_accountant',
      'deposit_completed',
      'back_office_ecash_requested',
      'back_office_ecash_approved',
      'float_requested',
      'float_allocated',
      'float_closed_pending_settlement',
      'workspace_activity',
      'collection_batch_pending',
      'collection_batch_posted',
      'susu_collection_reversed',
      'cash_shortage_opened',
      'cash_overage_opened',
      'cash_variance_settled'
    )
  );
