alter table public.users
  add column if not exists status text not null default 'active'
    check (status in ('active', 'inactive'));

alter table public.branches
  add column if not exists status text not null default 'active'
    check (status in ('active', 'inactive'));

create index if not exists idx_users_tenant_status on public.users (tenant_id, status);
create index if not exists idx_branches_tenant_status on public.branches (tenant_id, status);
