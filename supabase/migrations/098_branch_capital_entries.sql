-- Business capital injections & owner drawings per branch (feeds Susu Closing Balances & Admin capital ledger).

create table if not exists public.branch_capital_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  branch_id text not null,
  business_date date not null default (current_date),
  entry_type text not null check (entry_type in ('injection', 'drawing')),
  amount numeric(14, 2) not null check (amount > 0),
  source text,
  reference text,
  notes text,
  recorded_by text not null,
  recorded_by_name text,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_branch_capital_tenant_branch_date
  on public.branch_capital_entries (tenant_id, branch_id, business_date desc, created_at desc);

create index if not exists idx_branch_capital_tenant_date
  on public.branch_capital_entries (tenant_id, business_date desc, created_at desc);

comment on table public.branch_capital_entries is
  'Owner/business capital injections and owner drawings per branch; integrated into Susu closing vault and Admin total capital reporting.';

alter table public.branch_capital_entries enable row level security;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.branch_capital_entries;
    exception when duplicate_object then
      null;
    end;
  end if;
end $$;
