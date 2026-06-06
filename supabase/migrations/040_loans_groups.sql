-- Loan solidarity groups (040)

alter table public.loan_products
  add column if not exists loan_type text not null default 'individual'
    check (loan_type in ('individual', 'group_solidarity')),
  add column if not exists min_group_members integer,
  add column if not exists max_group_members integer;

create table if not exists public.loan_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  name text not null,
  branch_id text not null,
  description text,
  meeting_day text,
  min_members integer not null default 5 check (min_members >= 2),
  max_members integer not null default 15 check (max_members >= min_members),
  assigned_field_agent_id text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loan_groups_tenant_idx on public.loan_groups (tenant_id, status, name);

create table if not exists public.loan_group_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  group_id uuid not null references public.loan_groups (id) on delete cascade,
  customer_id text not null,
  role text not null default 'member'
    check (role in ('chair', 'secretary', 'treasurer', 'member')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  joined_at timestamptz not null default now(),
  unique (group_id, customer_id)
);

create index if not exists loan_group_members_group_idx on public.loan_group_members (group_id, status);
create index if not exists loan_group_members_customer_idx on public.loan_group_members (tenant_id, customer_id);

alter table public.loan_applications
  add column if not exists loan_type text not null default 'individual'
    check (loan_type in ('individual', 'group_solidarity')),
  add column if not exists group_id uuid references public.loan_groups (id);

create index if not exists loan_applications_group_idx on public.loan_applications (tenant_id, group_id);

comment on table public.loan_groups is 'Solidarity lending groups — roster of individual customers.';
comment on table public.loan_group_members is 'Members linked to loan groups with roles.';
