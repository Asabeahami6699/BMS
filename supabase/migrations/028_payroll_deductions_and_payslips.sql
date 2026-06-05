-- Per-user payroll deductions + persisted payslips after each run.

alter table public.user_payroll_profiles
  add column if not exists ssnit_rate_percent numeric(5, 2),
  add column if not exists ssnit_fixed_amount numeric(12, 2) not null default 0,
  add column if not exists welfare_deduction numeric(12, 2) not null default 0,
  add column if not exists loan_deduction numeric(12, 2) not null default 0;

create table if not exists public.payslips (
  id text not null,
  tenant_id text not null,
  user_id text not null,
  role text not null,
  period_id text not null,
  lines jsonb not null default '[]',
  deduction_lines jsonb not null default '[]',
  gross_pay numeric(12, 2) not null default 0,
  total_deductions numeric(12, 2) not null default 0,
  net_pay numeric(12, 2) not null default 0,
  run_at timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, user_id, period_id)
);

create index if not exists idx_payslips_tenant_period
  on public.payslips (tenant_id, period_id);

create index if not exists idx_payslips_tenant_user
  on public.payslips (tenant_id, user_id);
