-- Fixed payroll figures per role (applied automatically to all staff in that role).

create table if not exists public.role_payroll_defaults (
  tenant_id text not null,
  role text not null,
  base_salary numeric(12, 2) not null default 0,
  monthly_bonus numeric(12, 2) not null default 0,
  ssnit_rate_percent numeric(5, 2),
  ssnit_fixed_amount numeric(12, 2) not null default 0,
  welfare_deduction numeric(12, 2) not null default 0,
  loan_deduction numeric(12, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, role)
);

alter table public.user_payroll_profiles
  add column if not exists custom_payroll boolean not null default false;
