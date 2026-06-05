-- Agent-provided reason when requesting customer balance disclosure.

alter table public.customer_balance_disclosures
  add column if not exists request_reason text;
