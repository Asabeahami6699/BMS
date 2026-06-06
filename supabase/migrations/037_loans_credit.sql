-- Loans & credit product module (037)

create table if not exists public.loan_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  name text not null,
  description text,
  interest_rate_percent numeric(6, 2) not null default 0,
  term_months integer not null check (term_months > 0),
  min_amount numeric(14, 2) not null check (min_amount > 0),
  max_amount numeric(14, 2) not null check (max_amount >= min_amount),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loan_products_tenant_idx on public.loan_products (tenant_id, status);

create table if not exists public.loan_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  customer_id text not null,
  product_id uuid not null references public.loan_products (id),
  branch_id text not null,
  principal_amount numeric(14, 2) not null check (principal_amount > 0),
  interest_rate_percent numeric(6, 2) not null default 0,
  term_months integer not null check (term_months > 0),
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'rejected', 'disbursed', 'closed')),
  outstanding_principal numeric(14, 2) not null default 0,
  total_repaid numeric(14, 2) not null default 0,
  application_notes text,
  rejection_reason text,
  applied_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  disbursed_at timestamptz,
  disbursed_by text,
  closed_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loan_applications_tenant_status_idx
  on public.loan_applications (tenant_id, status, applied_at desc);

create index if not exists loan_applications_customer_idx
  on public.loan_applications (tenant_id, customer_id);

create table if not exists public.loan_repayments (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  loan_id uuid not null references public.loan_applications (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  branch_id text not null,
  notes text,
  recorded_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists loan_repayments_loan_idx on public.loan_repayments (loan_id, created_at desc);

comment on table public.loan_products is 'Tenant loan product templates for the loans_credit module.';
comment on table public.loan_applications is 'Loan applications through disbursement and repayment lifecycle.';
comment on table public.loan_repayments is 'Repayments recorded against disbursed loans.';
