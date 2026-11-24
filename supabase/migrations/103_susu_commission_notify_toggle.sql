-- Tenant toggle: decide whether deducting a Susu cycle commission sends a customer SMS/email message
alter table public.susu_commission_policies
  add column if not exists notify_customer_on_commission boolean not null default true;

comment on column public.susu_commission_policies.notify_customer_on_commission is
  'When true (default), customers receive a notification alert whenever Susu cycle commission is deducted.';
