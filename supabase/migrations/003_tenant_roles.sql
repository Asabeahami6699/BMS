create table if not exists public.tenant_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  role_key text not null,
  display_name text not null,
  duties jsonb not null default '[]'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, role_key)
);

create table if not exists public.user_role_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  user_id text not null,
  role_key text not null,
  assigned_by text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id, role_key)
);

alter table public.tenant_roles enable row level security;
alter table public.user_role_assignments enable row level security;

create policy tenant_roles_select on public.tenant_roles
for select using (tenant_id = public.jwt_tenant_id());

create policy tenant_roles_insert on public.tenant_roles
for insert with check (
  tenant_id = public.jwt_tenant_id()
  and public.jwt_scope_type() = 'head_office'
);

create policy user_role_assignments_select on public.user_role_assignments
for select using (tenant_id = public.jwt_tenant_id());

create policy user_role_assignments_insert on public.user_role_assignments
for insert with check (
  tenant_id = public.jwt_tenant_id()
  and public.jwt_scope_type() = 'head_office'
);
