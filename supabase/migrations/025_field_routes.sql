-- Collection routes: geographic areas tied to a branch and field agent.

create table if not exists public.field_routes (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  name text not null,
  area text not null,
  branch_id uuid not null references public.branches (id),
  assigned_field_agent_id text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_field_routes_tenant_branch_name
  on public.field_routes (tenant_id, branch_id, lower(name));

create index if not exists idx_field_routes_tenant_branch
  on public.field_routes (tenant_id, branch_id);

create index if not exists idx_field_routes_agent
  on public.field_routes (tenant_id, assigned_field_agent_id)
  where assigned_field_agent_id is not null;

alter table public.customers
  add column if not exists route_id uuid references public.field_routes (id) on delete set null;

create index if not exists idx_customers_route
  on public.customers (tenant_id, route_id)
  where route_id is not null;
