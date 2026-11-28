-- Tenant-based customer route management:
--   1. Geographical communities/areas array on field_routes (reusing customers.location)
--   2. Independent per-tenant route assignment strategy settings
--   3. Immutable customer assignment history audit trail (route + mobilizer changes)

-- 1. Support multiple geographical areas / communities per route.
alter table public.field_routes
  add column if not exists communities text[] not null default '{}';

-- 2. Independent tenant-level route assignment settings.
--    Default strategy = 'registration' to preserve existing behavior for all current tenants.
create table if not exists public.tenant_route_settings (
  tenant_id text primary key references public.tenants (id) on delete cascade,
  strategy text not null default 'registration'
    check (strategy in ('registration', 'location', 'manual')),
  auto_assign_on_approval boolean not null default true,
  sync_agent_on_route_change boolean not null default true,
  updated_by_user_id text,
  updated_at timestamptz not null default now()
);

alter table public.tenant_route_settings enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_route_settings'
      and policyname = 'tenant_route_settings_select'
  ) then
    create policy tenant_route_settings_select
      on public.tenant_route_settings
      for select using (tenant_id = public.jwt_tenant_id());
  end if;
end $$;

comment on table public.tenant_route_settings is
  'Per-tenant route assignment strategy (registration, location, manual) and automation preferences.';

-- 3. Immutable customer route & mobilizer assignment history.
--    Route IDs are stored without cascading delete so history remains intact even if a route is later deleted.
create table if not exists public.customer_assignment_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  customer_id uuid not null references public.customers (id) on delete cascade,
  branch_id text not null,
  previous_route_id uuid,
  previous_route_name text,
  new_route_id uuid,
  new_route_name text,
  previous_field_agent_id text,
  previous_field_agent_name text,
  new_field_agent_id text,
  new_field_agent_name text,
  changed_by_user_id text not null,
  changed_by_name text,
  change_source text not null default 'manual'
    check (change_source in (
      'approval_auto',
      'approval_manual',
      'transfer',
      'route_members',
      'route_agent_sync',
      'reorganization',
      'route_deleted',
      'manual'
    )),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_assignment_history_customer
  on public.customer_assignment_history (tenant_id, customer_id, created_at desc);

create index if not exists idx_customer_assignment_history_branch
  on public.customer_assignment_history (tenant_id, branch_id, created_at desc);

create index if not exists idx_customer_assignment_history_tenant_created
  on public.customer_assignment_history (tenant_id, created_at desc);

alter table public.customer_assignment_history enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_assignment_history'
      and policyname = 'customer_assignment_history_select'
  ) then
    create policy customer_assignment_history_select
      on public.customer_assignment_history
      for select using (tenant_id = public.jwt_tenant_id());
  end if;
end $$;

comment on table public.customer_assignment_history is
  'Append-only audit trail of customer route and mobilizer assignment changes (never mutates registration attribution or financial history).';

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.tenant_route_settings;
    exception when duplicate_object then
      null;
    end;
    begin
      alter publication supabase_realtime add table public.customer_assignment_history;
    exception when duplicate_object then
      null;
    end;
  end if;
end $$;
