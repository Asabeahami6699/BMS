-- Teller branch-till overages/shortages (separate from field_agent_cash_variances).

create table if not exists public.teller_till_cash_variances (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  cashier_user_id text not null,
  float_session_id uuid not null references public.branch_float_sessions(id) on delete cascade,
  business_date date not null,
  branch_id text,
  variance_type text not null
    check (variance_type in ('shortage', 'overage')),
  expected_cash numeric(14, 2) not null,
  actual_cash numeric(14, 2) not null,
  variance_amount numeric(14, 2) not null check (variance_amount > 0),
  outstanding_amount numeric(14, 2) not null check (outstanding_amount >= 0),
  status text not null default 'open'
    check (status in ('open', 'partially_settled', 'settled', 'written_off')),
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (float_session_id)
);

create table if not exists public.teller_till_cash_variance_settlements (
  id uuid primary key default gen_random_uuid(),
  variance_id uuid not null references public.teller_till_cash_variances(id) on delete cascade,
  tenant_id text not null,
  amount numeric(14, 2) not null check (amount > 0),
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

create index if not exists idx_teller_till_variances_tenant_status
  on public.teller_till_cash_variances (tenant_id, status, business_date desc);

create index if not exists idx_teller_till_variances_cashier
  on public.teller_till_cash_variances (tenant_id, cashier_user_id, status, business_date desc);

create index if not exists idx_teller_till_variance_settlements
  on public.teller_till_cash_variance_settlements (variance_id, recorded_at desc);

comment on table public.teller_till_cash_variances is
  'Branch teller till EOD overage/shortage cases — distinct from field agent callover variances.';

-- Pending till movements awaiting admin/coordinator approval
alter table public.branch_float_sessions
  add column if not exists extra_cash_requested numeric(14, 2),
  add column if not exists extra_cash_request_note text,
  add column if not exists expense_requested numeric(14, 2),
  add column if not exists expense_request_note text;

comment on column public.branch_float_sessions.extra_cash_requested is
  'Pending extra physical cash request awaiting approval.';
comment on column public.branch_float_sessions.expense_requested is
  'Pending till expense awaiting approval.';
