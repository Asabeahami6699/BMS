-- Core tenant-safe schema and RLS template.
-- Execute with service-role/admin migration only.

create extension if not exists pgcrypto;

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  code text not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  full_name text not null,
  phone text not null,
  home_branch_id uuid not null references public.branches(id),
  assigned_field_agent_id text not null,
  created_by_field_agent_id text not null,
  daily_contribution_amount numeric(12,2) not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.customer_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  customer_id uuid not null references public.customers(id),
  type text not null,
  amount numeric(12,2) not null,
  transaction_branch_id uuid not null references public.branches(id),
  home_branch_id uuid not null references public.branches(id),
  recorded_by_user_id text not null,
  field_agent_id text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  customer_id uuid not null references public.customers(id),
  transaction_id uuid not null references public.customer_transactions(id),
  entry_type text not null,
  amount numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  transaction_branch_id uuid not null references public.branches(id),
  created_at timestamptz not null default now()
);

create table if not exists public.users (
  id text primary key,
  tenant_id text not null,
  role text not null,
  scope_type text not null,
  branch_id uuid references public.branches(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_customers_tenant on public.customers(tenant_id);
create index if not exists idx_transactions_tenant on public.customer_transactions(tenant_id);
create index if not exists idx_ledger_tenant on public.ledger_entries(tenant_id);

alter table public.branches enable row level security;
alter table public.customers enable row level security;
alter table public.customer_transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.users enable row level security;

-- Helper claims extracted from JWT.
create or replace function public.jwt_tenant_id()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'tenant_id', '');
$$;

create or replace function public.jwt_scope_type()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'scope_type', 'branch');
$$;

create or replace function public.jwt_branch_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'branch_id', '')::uuid;
$$;

-- Branch visibility: head office sees all tenant rows, branch scope sees only own branch.
create or replace function public.can_access_branch(target_branch_id uuid)
returns boolean
language sql
stable
as $$
  select
    public.jwt_scope_type() = 'head_office'
    or public.jwt_branch_id() = target_branch_id;
$$;

create policy branches_select on public.branches
for select
using (
  tenant_id = public.jwt_tenant_id()
  and public.can_access_branch(id)
);

create policy customers_select on public.customers
for select
using (
  tenant_id = public.jwt_tenant_id()
  and (
    public.jwt_scope_type() = 'head_office'
    or public.can_access_branch(home_branch_id)
  )
);

create policy customers_insert on public.customers
for insert
with check (
  tenant_id = public.jwt_tenant_id()
  and (
    public.jwt_scope_type() = 'head_office'
    or public.can_access_branch(home_branch_id)
  )
);

create policy transactions_select on public.customer_transactions
for select
using (
  tenant_id = public.jwt_tenant_id()
  and (
    public.jwt_scope_type() = 'head_office'
    or public.can_access_branch(transaction_branch_id)
    or public.can_access_branch(home_branch_id)
  )
);

create policy transactions_insert on public.customer_transactions
for insert
with check (
  tenant_id = public.jwt_tenant_id()
  and (
    public.jwt_scope_type() = 'head_office'
    or public.can_access_branch(transaction_branch_id)
  )
);

create policy ledger_select on public.ledger_entries
for select
using (
  tenant_id = public.jwt_tenant_id()
  and (
    public.jwt_scope_type() = 'head_office'
    or public.can_access_branch(transaction_branch_id)
  )
);

create policy users_select on public.users
for select
using (tenant_id = public.jwt_tenant_id());

-- IMPORTANT:
-- 1) Keep service-role key only on backend.
-- 2) Express enforces authorization AND branch checks before DB writes.
-- 3) For realtime, subscribe with authenticated user token so RLS still applies.
