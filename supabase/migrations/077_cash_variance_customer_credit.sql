-- Allow linking OS overage settlements to a customer credit ("Settled shortage").

alter table public.field_agent_cash_variance_settlements
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists transaction_id uuid references public.customer_transactions(id) on delete set null;
