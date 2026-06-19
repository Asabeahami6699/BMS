-- Partner bank account openings are third-party records; customer link is optional.

alter table public.customer_partner_bank_accounts
  alter column customer_id drop not null;
