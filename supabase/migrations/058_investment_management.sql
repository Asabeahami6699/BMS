-- Investment & wealth management module (058)

create table if not exists public.investment_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  product_type text not null
    check (product_type in ('fixed_deposit', 'treasury_bill', 'government_bond', 'shares')),
  name text not null,
  description text,
  default_rate_percent numeric(8, 4) not null default 0,
  default_tenure_days integer not null check (default_tenure_days > 0),
  min_amount numeric(16, 2) not null check (min_amount > 0),
  max_amount numeric(16, 2) not null check (max_amount >= min_amount),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists investment_products_tenant_idx
  on public.investment_products (tenant_id, status, product_type);

create table if not exists public.investment_form_configs (
  tenant_id text primary key,
  sections jsonb not null default '[]'::jsonb,
  fields jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.investments (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  investment_number text not null,
  product_id uuid references public.investment_products (id),
  product_type text not null
    check (product_type in ('fixed_deposit', 'treasury_bill', 'government_bond', 'shares')),
  product_name text not null,
  branch_id text not null,
  officer_user_id text,
  customer_id text,
  customer_name text not null,
  customer_phone text,
  customer_snapshot jsonb not null default '{}'::jsonb,
  custom_fields jsonb not null default '{}'::jsonb,
  principal_amount numeric(16, 2) not null check (principal_amount > 0),
  interest_rate_percent numeric(8, 4) not null default 0,
  tenure_days integer not null check (tenure_days > 0),
  start_date date not null,
  maturity_date date not null,
  expected_interest numeric(16, 2) not null default 0,
  expected_maturity_value numeric(16, 2) not null default 0,
  auto_renewal text not null default 'none'
    check (auto_renewal in ('none', 'principal_only', 'principal_and_interest')),
  status text not null default 'active'
    check (status in ('active', 'matured', 'closed', 'redeemed', 'cancelled')),
  parent_investment_id uuid references public.investments (id),
  renewal_cycle integer not null default 1 check (renewal_cycle > 0),
  created_by text not null,
  modified_by text,
  approved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (tenant_id, investment_number)
);

create index if not exists investments_tenant_status_idx
  on public.investments (tenant_id, status, created_at desc);
create index if not exists investments_tenant_search_idx
  on public.investments (tenant_id, customer_name, customer_phone, investment_number);
create index if not exists investments_branch_idx on public.investments (tenant_id, branch_id);
create index if not exists investments_officer_idx on public.investments (tenant_id, officer_user_id);

create table if not exists public.investment_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  investment_id uuid not null references public.investments (id) on delete cascade,
  name text not null,
  relationship text not null,
  phone text,
  alt_phone text,
  email text,
  address text,
  allocation_percent numeric(5, 2) not null check (allocation_percent >= 0 and allocation_percent <= 100),
  created_at timestamptz not null default now()
);

create index if not exists investment_beneficiaries_investment_idx
  on public.investment_beneficiaries (investment_id);

create table if not exists public.investment_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  investment_id uuid not null references public.investments (id) on delete cascade,
  kind text not null
    check (kind in ('passport_photo', 'signature', 'national_id', 'utility_bill', 'supporting')),
  file_name text not null,
  mime_type text,
  content_url text,
  uploaded_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists investment_attachments_investment_idx
  on public.investment_attachments (investment_id);

create table if not exists public.investment_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  investment_id uuid not null references public.investments (id) on delete cascade,
  action text not null,
  actor_user_id text not null,
  actor_role text,
  changes jsonb,
  created_at timestamptz not null default now()
);

create index if not exists investment_audit_log_investment_idx
  on public.investment_audit_log (investment_id, created_at desc);

comment on table public.investment_products is 'Tenant investment product catalog (fixed deposit, T-bills, bonds, shares).';
comment on table public.investment_form_configs is 'Per-tenant customizable investment application form.';
comment on table public.investments is 'Customer investment applications and active positions.';
comment on table public.investment_beneficiaries is 'Beneficiary allocations for an investment.';
comment on table public.investment_attachments is 'Customer KYC and supporting documents.';
comment on table public.investment_audit_log is 'Investment change history and approvals.';
