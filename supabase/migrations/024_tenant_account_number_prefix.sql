-- Company-defined prefix for 12-digit customer account numbers (suffix auto-generated on approval).

alter table public.tenants
  add column if not exists account_number_prefix text;

comment on column public.tenants.account_number_prefix is
  'Leading digits for customer account numbers; remaining digits are random at approval (total length 12).';
