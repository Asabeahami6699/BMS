-- Tenant-configurable Susu cycle commission (customer fee) — separate from agent payroll commission.
-- Supports first-collection, cycle-maturity, and withdrawal deduction methods with policy snapshots per cycle.

create type public.susu_commission_basis as enum (
  'first_day',
  'fixed',
  'percentage',
  'none'
);

create type public.susu_commission_deduction_timing as enum (
  'first_collection',
  'cycle_maturity',
  'withdrawal'
);

create type public.susu_commission_rollover_treatment as enum (
  'deduct',
  'defer',
  'waive'
);

create type public.susu_commission_partial_allocation as enum (
  'commission_first',
  'savings_first',
  'proportional'
);

create type public.susu_commission_early_withdrawal as enum (
  'deduct_full',
  'deduct_pro_rata',
  'waive',
  'block'
);

create type public.susu_daily_contribution_mode as enum (
  'fixed',
  'flexible'
);

create type public.susu_cycle_status as enum (
  'open',
  'matured',
  'closed',
  'rolled_over'
);

create table if not exists public.susu_commission_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  version integer not null check (version > 0),
  enabled boolean not null default true,
  currency text not null default 'GHS',
  daily_contribution_mode public.susu_daily_contribution_mode not null default 'flexible',
  default_daily_contribution_ghs numeric(18, 2) not null default 10 check (default_daily_contribution_ghs >= 0),
  cycle_days integer not null default 31 check (cycle_days > 0 and cycle_days <= 366),
  commission_basis public.susu_commission_basis not null default 'first_day',
  commission_fixed_amount numeric(18, 2) not null default 0 check (commission_fixed_amount >= 0),
  commission_percent numeric(8, 4) not null default 0 check (commission_percent >= 0 and commission_percent <= 100),
  deduction_timing public.susu_commission_deduction_timing not null default 'first_collection',
  rollover_treatment public.susu_commission_rollover_treatment not null default 'defer',
  partial_allocation public.susu_commission_partial_allocation not null default 'commission_first',
  early_withdrawal_policy public.susu_commission_early_withdrawal not null default 'deduct_full',
  effective_from date not null default (current_date),
  created_by_user_id text,
  created_at timestamptz not null default now(),
  unique (tenant_id, version)
);

create index if not exists susu_commission_policies_tenant_idx
  on public.susu_commission_policies (tenant_id, version desc);

create table if not exists public.susu_customer_cycles (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  customer_id text not null,
  branch_id text not null,
  policy_id uuid not null references public.susu_commission_policies (id),
  policy_version integer not null,
  cycle_number integer not null check (cycle_number > 0),
  status public.susu_cycle_status not null default 'open',
  -- Frozen agreement at cycle open
  daily_contribution_amount numeric(18, 2) not null check (daily_contribution_amount >= 0),
  cycle_days integer not null check (cycle_days > 0),
  commission_basis public.susu_commission_basis not null,
  commission_agreed_amount numeric(18, 2) not null check (commission_agreed_amount >= 0),
  deduction_timing public.susu_commission_deduction_timing not null,
  rollover_treatment public.susu_commission_rollover_treatment not null,
  partial_allocation public.susu_commission_partial_allocation not null,
  early_withdrawal_policy public.susu_commission_early_withdrawal not null,
  -- Running totals
  gross_contributions numeric(18, 2) not null default 0 check (gross_contributions >= 0),
  customer_savings_credited numeric(18, 2) not null default 0 check (customer_savings_credited >= 0),
  commission_earned numeric(18, 2) not null default 0 check (commission_earned >= 0),
  commission_collected numeric(18, 2) not null default 0 check (commission_collected >= 0),
  commission_outstanding numeric(18, 2) not null default 0 check (commission_outstanding >= 0),
  collections_count integer not null default 0 check (collections_count >= 0),
  contribution_days integer not null default 0 check (contribution_days >= 0),
  opened_at timestamptz not null default now(),
  first_collection_at timestamptz,
  matured_at timestamptz,
  closed_at timestamptz,
  rolled_from_cycle_id uuid references public.susu_customer_cycles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists susu_customer_cycles_open_uq
  on public.susu_customer_cycles (tenant_id, customer_id)
  where status = 'open';

create index if not exists susu_customer_cycles_tenant_customer_idx
  on public.susu_customer_cycles (tenant_id, customer_id, cycle_number desc);

create index if not exists susu_customer_cycles_tenant_status_idx
  on public.susu_customer_cycles (tenant_id, status);

alter table public.susu_commission_policies enable row level security;
alter table public.susu_customer_cycles enable row level security;

create policy susu_commission_policies_select on public.susu_commission_policies
for select using (tenant_id = public.jwt_tenant_id());

create policy susu_customer_cycles_select on public.susu_customer_cycles
for select using (tenant_id = public.jwt_tenant_id());

comment on table public.susu_commission_policies is
  'Versioned tenant Susu customer commission rules. Agent payroll commission is separate.';

comment on table public.susu_customer_cycles is
  'Per-customer Susu cycle with frozen fee terms. One commission charge per eligible cycle.';

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.susu_commission_policies;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.susu_customer_cycles;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
