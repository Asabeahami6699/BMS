-- Loan application credit assessment fields (039)

alter table public.loan_applications
  add column if not exists loan_purpose text,
  add column if not exists loan_purpose_other text,
  add column if not exists source_of_income text,
  add column if not exists source_of_income_other text,
  add column if not exists occupation text,
  add column if not exists employer_or_business text,
  add column if not exists monthly_income numeric(14, 2),
  add column if not exists monthly_expenses numeric(14, 2),
  add column if not exists existing_loan_balance numeric(14, 2),
  add column if not exists years_at_current_job numeric(4, 1),
  add column if not exists guarantor jsonb;

comment on column public.loan_applications.guarantor is 'Guarantor contact and income details for credit assessment.';
