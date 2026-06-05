-- Per-tenant permission sets for built-in job titles (admin, coordinator, etc.).

create table if not exists public.tenant_builtin_role_overrides (
  tenant_id text not null,
  role text not null,
  duties jsonb not null default '[]'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, role),
  constraint tenant_builtin_role_overrides_role_check
    check (
      role in (
        'admin',
        'coordinator',
        'teller',
        'accountant',
        'auditor',
        'customer_service'
      )
    )
);

alter table public.tenant_builtin_role_overrides enable row level security;

create policy tenant_builtin_role_overrides_select on public.tenant_builtin_role_overrides
for select using (tenant_id = public.jwt_tenant_id());

create policy tenant_builtin_role_overrides_upsert on public.tenant_builtin_role_overrides
for all using (
  tenant_id = public.jwt_tenant_id()
  and public.jwt_scope_type() = 'head_office'
)
with check (
  tenant_id = public.jwt_tenant_id()
  and public.jwt_scope_type() = 'head_office'
);
