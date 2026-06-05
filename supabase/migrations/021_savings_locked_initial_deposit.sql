-- Savings accounts: locked opening deposit (not withdrawable by customer).

alter table public.customers
  add column if not exists locked_balance numeric(12,2) not null default 0;

create or replace function public.post_customer_transaction_atomic(
  p_transaction_id uuid,
  p_tenant_id text,
  p_customer_id uuid,
  p_type text,
  p_amount numeric,
  p_transaction_branch_id uuid,
  p_home_branch_id uuid,
  p_recorded_by_user_id text,
  p_field_agent_id text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_type text;
  v_balance numeric;
  v_locked numeric;
  v_withdrawable numeric;
  v_customer_id uuid;
begin
  if p_type not in ('daily_susu', 'deposit', 'withdrawal') then
    raise exception 'Invalid transaction type: %', p_type;
  end if;

  v_entry_type := case when p_type = 'withdrawal' then 'debit' else 'credit' end;

  select id, coalesce(locked_balance, 0)
  into v_customer_id, v_locked
  from public.customers
  where id = p_customer_id and tenant_id = p_tenant_id
  for update;

  if v_customer_id is null then
    raise exception 'Customer not found';
  end if;

  select coalesce(
    sum(case when entry_type = 'credit' then amount else -amount end),
    0
  )
  into v_balance
  from public.ledger_entries
  where tenant_id = p_tenant_id and customer_id = p_customer_id;

  v_withdrawable := greatest(v_balance - v_locked, 0);

  if p_type = 'withdrawal' and v_withdrawable < p_amount then
    raise exception 'Insufficient withdrawable balance';
  end if;

  insert into public.customer_transactions (
    id,
    tenant_id,
    customer_id,
    type,
    amount,
    transaction_branch_id,
    home_branch_id,
    recorded_by_user_id,
    field_agent_id,
    notes
  )
  values (
    p_transaction_id,
    p_tenant_id,
    p_customer_id,
    p_type,
    p_amount,
    p_transaction_branch_id,
    p_home_branch_id,
    p_recorded_by_user_id,
    p_field_agent_id,
    p_notes
  );

  if v_entry_type = 'credit' then
    v_balance := v_balance + p_amount;
  else
    v_balance := v_balance - p_amount;
  end if;

  insert into public.ledger_entries (
    tenant_id,
    customer_id,
    transaction_id,
    entry_type,
    amount,
    balance_after,
    transaction_branch_id
  )
  values (
    p_tenant_id,
    p_customer_id,
    p_transaction_id,
    v_entry_type,
    p_amount,
    v_balance,
    p_transaction_branch_id
  );
end;
$$;
