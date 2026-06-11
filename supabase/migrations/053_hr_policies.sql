-- HR policies: late check-in threshold and annual leave days per job title.

create table if not exists public.hr_policies (
  tenant_id text primary key references public.tenants(id) on delete cascade,
  late_check_in_time time not null default '09:00:00',
  default_annual_leave_days int not null default 21 check (default_annual_leave_days >= 0),
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.hr_role_leave_entitlements (
  tenant_id text not null references public.tenants(id) on delete cascade,
  role_key text not null,
  annual_leave_days int not null check (annual_leave_days >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, role_key)
);
