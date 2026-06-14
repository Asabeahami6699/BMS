-- Operator transaction PIN (teller / back office step-up before money mutations)
alter table public.users
  add column if not exists transaction_pin_hash text,
  add column if not exists transaction_pin_set_at timestamptz,
  add column if not exists transaction_pin_failed_attempts integer not null default 0,
  add column if not exists transaction_pin_locked_until timestamptz;
