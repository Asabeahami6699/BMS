-- Susu Management: branch counter till float (teller drawer for susu-only tenants).
-- This is NOT the Banking product vault module; banking will extend/reuse later.
-- Field agents do NOT use this — they collect in the field and remit to branch.

create table if not exists public.branch_float_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  branch_id text not null,
  cashier_user_id text not null,
  business_date date not null default (current_date),
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'open', 'closed', 'settled', 'rejected')),
  opening_float numeric(14, 2) not null default 0,
  expected_closing numeric(14, 2),
  actual_closing numeric(14, 2),
  variance numeric(14, 2),
  total_deposits numeric(14, 2) not null default 0,
  total_withdrawals numeric(14, 2) not null default 0,
  total_daily_susu numeric(14, 2) not null default 0,
  transaction_count integer not null default 0,
  requested_at timestamptz not null default now(),
  requested_note text,
  allocated_by text,
  allocated_at timestamptz,
  closed_at timestamptz,
  settled_by text,
  settled_at timestamptz,
  variance_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, cashier_user_id, business_date)
);

create index if not exists branch_float_sessions_tenant_branch_idx
  on public.branch_float_sessions (tenant_id, branch_id, business_date desc);

create table if not exists public.branch_float_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  session_id uuid not null references public.branch_float_sessions (id) on delete cascade,
  movement_type text not null
    check (movement_type in ('allocation', 'deposit', 'withdrawal', 'adjustment', 'settlement')),
  amount numeric(14, 2) not null,
  customer_transaction_id text,
  notes text,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists branch_float_movements_session_idx
  on public.branch_float_movements (session_id, created_at);

comment on table public.branch_float_sessions is
  'Susu branch counter daily till: request/open float, post deposits/withdrawals/Susu, EOD close and settle.';
