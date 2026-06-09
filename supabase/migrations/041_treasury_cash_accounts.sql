-- Treasury: branch cash accounts (vault, teller drawer, bank) and movement journal.
-- Complements Susu till float (030) with institutional cash positions and trial balance.

create type public.cash_account_kind as enum (
  'vault',
  'teller_drawer',
  'bank',
  'expense',
  'commission'
);

create type public.cash_movement_type as enum (
  'vault_to_teller',
  'teller_to_vault',
  'vault_to_bank',
  'bank_to_vault',
  'expense',
  'commission'
);

create table if not exists public.branch_cash_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  branch_id text not null,
  kind public.cash_account_kind not null,
  label text not null,
  currency text not null default 'GHS',
  balance numeric(18, 2) not null default 0 check (balance >= 0),
  teller_user_id text,
  bank_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists branch_cash_accounts_vault_uq
  on public.branch_cash_accounts (tenant_id, branch_id)
  where kind = 'vault' and is_active = true;

create unique index if not exists branch_cash_accounts_teller_uq
  on public.branch_cash_accounts (tenant_id, branch_id, teller_user_id)
  where kind = 'teller_drawer' and teller_user_id is not null and is_active = true;

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  branch_id text not null,
  movement_type public.cash_movement_type not null,
  from_account_id uuid references public.branch_cash_accounts (id),
  to_account_id uuid references public.branch_cash_accounts (id),
  amount numeric(18, 2) not null check (amount > 0),
  notes text,
  recorded_by_user_id text not null,
  business_date date not null default (current_date),
  created_at timestamptz not null default now()
);

create index if not exists cash_movements_tenant_branch_date_idx
  on public.cash_movements (tenant_id, branch_id, business_date desc);

create index if not exists branch_cash_accounts_tenant_branch_idx
  on public.branch_cash_accounts (tenant_id, branch_id);

alter table public.branch_cash_accounts enable row level security;
alter table public.cash_movements enable row level security;

create policy branch_cash_accounts_select on public.branch_cash_accounts
for select using (tenant_id = public.jwt_tenant_id());

create policy cash_movements_select on public.cash_movements
for select using (tenant_id = public.jwt_tenant_id());
