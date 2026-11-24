-- Floating top-bar announcements for Super Admin (site-wide) and Company Admin (tenant-scoped) with optional countdown timer.

create table if not exists public.site_announcements (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('platform', 'tenant')),
  tenant_id text null,
  title text,
  message text not null,
  tone text not null default 'info' check (tone in ('info', 'warning', 'critical', 'success')),
  is_active boolean not null default true,
  dismissible boolean not null default true,
  starts_at timestamptz not null default now(),
  expires_at timestamptz null,
  duration_minutes integer null check (duration_minutes is null or duration_minutes > 0),
  created_by text not null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_announcements_scope_tenant_check check (
    (scope = 'platform' and tenant_id is null) or
    (scope = 'tenant' and tenant_id is not null and length(trim(tenant_id)) > 0)
  )
);

create index if not exists idx_site_announcements_active_platform
  on public.site_announcements (scope, is_active, expires_at)
  where scope = 'platform';

create index if not exists idx_site_announcements_active_tenant
  on public.site_announcements (tenant_id, is_active, expires_at)
  where scope = 'tenant';

alter table public.site_announcements enable row level security;

drop policy if exists site_announcements_select on public.site_announcements;
create policy site_announcements_select on public.site_announcements
for select using (
  scope = 'platform'
  or tenant_id = public.jwt_tenant_id()
);
