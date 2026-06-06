-- Loans schedule & repayment frequency (038)

alter table public.loan_products
  add column if not exists repayment_frequency text not null default 'monthly'
  check (repayment_frequency in ('weekly', 'monthly'));

alter table public.loan_applications
  add column if not exists repayment_frequency text not null default 'monthly'
  check (repayment_frequency in ('weekly', 'monthly'));

alter table public.loan_applications
  add column if not exists installment_amount numeric(14, 2);

alter table public.loan_applications
  add column if not exists total_interest numeric(14, 2) not null default 0;

alter table public.loan_applications
  add column if not exists total_repayable numeric(14, 2) not null default 0;

alter table public.loan_applications
  add column if not exists installments_total integer;

alter table public.loan_applications
  add column if not exists installments_paid integer not null default 0;

alter table public.loan_applications
  add column if not exists next_due_date date;

create table if not exists public.loan_repayment_schedule (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  loan_id uuid not null references public.loan_applications (id) on delete cascade,
  installment_number integer not null check (installment_number > 0),
  due_date date not null,
  amount_due numeric(14, 2) not null check (amount_due > 0),
  amount_paid numeric(14, 2) not null default 0 check (amount_paid >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'partial', 'overdue')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (loan_id, installment_number)
);

create index if not exists loan_repayment_schedule_loan_idx
  on public.loan_repayment_schedule (loan_id, installment_number);

alter table public.loan_repayments
  add column if not exists installment_number integer;

comment on table public.loan_repayment_schedule is 'Installment schedule generated when a loan is disbursed.';
