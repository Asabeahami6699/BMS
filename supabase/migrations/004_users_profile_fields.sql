alter table public.users
  add column if not exists email text,
  add column if not exists created_by text;

create index if not exists idx_users_tenant_role on public.users(tenant_id, role);
