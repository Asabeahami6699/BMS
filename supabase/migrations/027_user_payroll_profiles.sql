-- Per-user payslip settings: base salary, commission override, monthly bonus.

create table if not exists public.user_payroll_profiles (
  tenant_id text not null,
  user_id text not null,
  base_salary numeric(12, 2) not null default 0,
  commission_percent_override numeric(5, 2),
  monthly_bonus numeric(12, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index if not exists idx_user_payroll_profiles_tenant
  on public.user_payroll_profiles (tenant_id);
