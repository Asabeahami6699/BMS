-- Savings accounts: custom initial deposit (credited upon approval once account number is ready)
-- and snapshot of the Commission Settings "When to deduct" timing for locked_balance.

alter table public.customers
  add column if not exists initial_deposit_amount numeric(12, 2) not null default 0,
  add column if not exists initial_deposit_credited_at timestamptz,
  add column if not exists savings_lock_timing text,
  add column if not exists savings_lock_target_amount numeric(12, 2) not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customers_savings_lock_timing_check'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_savings_lock_timing_check
      check (
        savings_lock_timing is null
        or savings_lock_timing in ('first_collection', 'cycle_maturity', 'withdrawal')
      );
  end if;
end $$;

comment on column public.customers.initial_deposit_amount is
  'Savings account opening deposit captured at registration and credited once the account is approved and assigned an account number.';
comment on column public.customers.initial_deposit_credited_at is
  'Timestamp when the initial savings deposit was credited on approval (idempotency guard).';
comment on column public.customers.savings_lock_timing is
  'Snapshot of Commission Settings deduction_timing (first_collection | cycle_maturity | withdrawal) governing when locked_balance is enforced.';
comment on column public.customers.savings_lock_target_amount is
  'Target minimum locked_balance (GHS) snapshotted for this savings account.';
