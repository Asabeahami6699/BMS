-- Who may approve new accounts and withdrawals. Null keeps the built-in defaults.

alter table public.tenants
  add column if not exists approval_workflows jsonb;
