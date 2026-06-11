-- Universal operations: attendance photos, staff loans, announcements, documents, incidents.

alter table public.hr_attendance_records
  add column if not exists check_out time,
  add column if not exists check_in_photo_url text,
  add column if not exists check_out_photo_url text;

alter table public.hr_leave_requests
  add column if not exists rejected_reason text,
  add column if not exists reviewed_by text,
  add column if not exists reviewed_at timestamptz;

create table if not exists public.hr_staff_loans (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  user_id text not null,
  amount numeric(14, 2) not null check (amount > 0),
  purpose text not null,
  term_months int not null check (term_months > 0),
  monthly_deduction numeric(14, 2),
  outstanding_balance numeric(14, 2),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'active', 'closed')),
  notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.company_announcements (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  title text not null,
  body text not null,
  category text not null default 'Internal news',
  pinned boolean not null default false,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.company_announcement_acks (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  announcement_id uuid not null references public.company_announcements(id) on delete cascade,
  user_id text not null,
  acknowledged_at timestamptz not null default now(),
  unique (tenant_id, announcement_id, user_id)
);

create table if not exists public.company_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  title text not null,
  category text not null,
  file_url text,
  version text not null default '1.0',
  uploaded_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.incident_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  user_id text not null,
  incident_type text not null,
  description text not null,
  status text not null default 'pending' check (status in ('pending', 'investigating', 'resolved', 'closed')),
  resolution_notes text,
  reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_staff_loans_tenant_user_idx on public.hr_staff_loans (tenant_id, user_id, created_at desc);
create index if not exists company_announcements_tenant_idx on public.company_announcements (tenant_id, published_at desc);
create index if not exists company_documents_tenant_idx on public.company_documents (tenant_id, created_at desc);
create index if not exists incident_reports_tenant_idx on public.incident_reports (tenant_id, created_at desc);
