-- Per-tenant Susu Management sidebar visibility (job titles + permissions per menu item).

create table if not exists public.tenant_susu_nav_overrides (
  tenant_id text not null,
  nav_path text not null,
  roles jsonb not null default '[]'::jsonb,
  any_permissions jsonb not null default '[]'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, nav_path)
);

alter table public.tenant_susu_nav_overrides enable row level security;

create policy tenant_susu_nav_overrides_select on public.tenant_susu_nav_overrides
for select using (tenant_id = public.jwt_tenant_id());

create policy tenant_susu_nav_overrides_mutate on public.tenant_susu_nav_overrides
for all using (
  tenant_id = public.jwt_tenant_id()
  and public.jwt_scope_type() = 'head_office'
)
with check (
  tenant_id = public.jwt_tenant_id()
  and public.jwt_scope_type() = 'head_office'
);
