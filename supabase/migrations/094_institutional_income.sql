-- Institutional income accounts (company fee income) — separate from agent payroll commission.
-- Receives Susu cycle commissions, savings fixed fees, and current-account fixed fees.

create type public.institutional_income_source as enum (
  'susu_commission',
  'savings_fee',
  'current_fee',
  'meba_daakye_fee',
  'other'
);

create table if not exists public.branch_income_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  branch_id text not null,
  label text not null,
  currency text not null default 'GHS',
  balance numeric(18, 2) not null default 0 check (balance >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists branch_income_accounts_tenant_branch_uq
  on public.branch_income_accounts (tenant_id, branch_id)
  where is_active = true;

create index if not exists branch_income_accounts_tenant_idx
  on public.branch_income_accounts (tenant_id);

create table if not exists public.institutional_income_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  branch_id text not null,
  income_account_id uuid not null references public.branch_income_accounts (id),
  source public.institutional_income_source not null,
  amount numeric(18, 2) not null check (amount > 0),
  business_date date not null default (current_date),
  customer_id text,
  transaction_id text,
  notes text,
  idempotency_key text not null,
  recorded_by_user_id text not null,
  reverses_entry_id uuid references public.institutional_income_entries (id),
  reversed_at timestamptz,
  reversed_by_entry_id uuid references public.institutional_income_entries (id),
  reversal_reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists institutional_income_entries_idempotency_uq
  on public.institutional_income_entries (tenant_id, idempotency_key);

create index if not exists institutional_income_entries_tenant_branch_date_idx
  on public.institutional_income_entries (tenant_id, branch_id, business_date desc);

create index if not exists institutional_income_entries_tenant_date_idx
  on public.institutional_income_entries (tenant_id, business_date desc);

create index if not exists institutional_income_entries_source_idx
  on public.institutional_income_entries (tenant_id, source, business_date desc);

alter table public.branch_income_accounts enable row level security;
alter table public.institutional_income_entries enable row level security;

create policy branch_income_accounts_select on public.branch_income_accounts
for select using (tenant_id = public.jwt_tenant_id());

create policy institutional_income_entries_select on public.institutional_income_entries
for select using (tenant_id = public.jwt_tenant_id());

comment on table public.branch_income_accounts is
  'Per-branch institutional income account for company fee revenue (not agent payroll).';

comment on table public.institutional_income_entries is
  'Atomic, idempotent institutional fee postings: Susu commission, savings/current fixed fees.';

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    begin
      alter publication supabase_realtime add table public.branch_income_accounts;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.institutional_income_entries;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
