-- HR: leave, attendance, training/compliance (tenant-scoped).

create table if not exists public.hr_leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  user_id text not null,
  leave_type text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.hr_attendance_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  user_id text not null,
  branch_id text,
  business_date date not null,
  status text not null check (status in ('present', 'absent', 'late', 'leave')),
  check_in time,
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id, business_date)
);

create table if not exists public.hr_training_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  user_id text not null,
  training_title text not null,
  completed_on date,
  expires_on date,
  status text not null default 'due' check (status in ('due', 'completed', 'expired')),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.users
  add column if not exists employment_date date;

create index if not exists hr_leave_requests_tenant_idx on public.hr_leave_requests (tenant_id, created_at desc);
create index if not exists hr_attendance_records_tenant_date_idx on public.hr_attendance_records (tenant_id, business_date desc);
create index if not exists hr_training_records_tenant_idx on public.hr_training_records (tenant_id, status);
