-- Controlled reversal of a posted susu credit.
-- The original row stays. A linked susu_reversal debit corrects the ledger.
-- Cash is not refunded from the till.

alter table public.customer_transactions
  add column if not exists reverses_transaction_id uuid references public.customer_transactions(id),
  add column if not exists reversed_by_transaction_id uuid,
  add column if not exists reversal_reason text,
  add column if not exists reversed_by_user_id text,
  add column if not exists reversed_at timestamptz;

create unique index if not exists uq_customer_transactions_one_reversal
  on public.customer_transactions (reverses_transaction_id)
  where reverses_transaction_id is not null;

create unique index if not exists uq_customer_transactions_reversed_once
  on public.customer_transactions (reversed_by_transaction_id)
  where reversed_by_transaction_id is not null;

alter table public.audit_logs
  add column if not exists details jsonb;

create or replace function public.reverse_susu_collection_atomic(
  p_reversal_id uuid,
  p_tenant_id text,
  p_original_id uuid,
  p_actor_user_id text,
  p_actor_role text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.customer_transactions%rowtype;
  v_customer_id uuid;
  v_locked numeric;
  v_balance numeric;
  v_next numeric;
  v_customer_name text;
  v_account text;
  v_reason text;
begin
  v_reason := trim(coalesce(p_reason, ''));
  if length(v_reason) < 3 then
    raise exception 'Enter a reversal reason (at least 3 characters)';
  end if;

  select *
  into v_tx
  from public.customer_transactions
  where id = p_original_id and tenant_id = p_tenant_id
  for update;

  if v_tx.id is null then
    raise exception 'Transaction not found';
  end if;

  if v_tx.type <> 'daily_susu' or v_tx.reverses_transaction_id is not null then
    raise exception 'Only a posted susu collection can be reversed';
  end if;

  if v_tx.reversed_at is not null or v_tx.reversed_by_transaction_id is not null then
    raise exception 'This collection has already been reversed';
  end if;

  if v_tx.execution_status is not null and v_tx.execution_status <> 'completed' then
    raise exception 'Only a completed susu collection can be reversed';
  end if;

  select id, coalesce(locked_balance, 0), full_name, account_number
  into v_customer_id, v_locked, v_customer_name, v_account
  from public.customers
  where id = v_tx.customer_id and tenant_id = p_tenant_id
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
  where tenant_id = p_tenant_id and customer_id = v_tx.customer_id;

  if v_balance - v_tx.amount < coalesce(v_locked, 0) then
    raise exception 'Customer balance is not high enough to reverse this collection';
  end if;

  v_next := v_balance - v_tx.amount;

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
    notes,
    reverses_transaction_id,
    reversal_reason,
    execution_status
  )
  values (
    p_reversal_id,
    p_tenant_id,
    v_tx.customer_id,
    'susu_reversal',
    v_tx.amount,
    v_tx.transaction_branch_id,
    v_tx.home_branch_id,
    p_actor_user_id,
    v_tx.field_agent_id,
    'Reversal of ' || v_tx.id::text || '. ' || v_reason,
    v_tx.id,
    v_reason,
    'completed'
  );

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
    v_tx.customer_id,
    p_reversal_id,
    'debit',
    v_tx.amount,
    v_next,
    v_tx.transaction_branch_id
  );

  update public.customer_transactions
  set
    reversed_by_transaction_id = p_reversal_id,
    reversal_reason = v_reason,
    reversed_by_user_id = p_actor_user_id,
    reversed_at = now()
  where id = v_tx.id
    and tenant_id = p_tenant_id
    and reversed_at is null
    and reversed_by_transaction_id is null;

  if not found then
    raise exception 'This collection has already been reversed';
  end if;

  insert into public.audit_logs (
    tenant_id,
    actor_user_id,
    actor_role,
    method,
    path,
    status_code,
    branch_id,
    action,
    details
  )
  values (
    p_tenant_id,
    p_actor_user_id,
    p_actor_role,
    'POST',
    '/api/v1/transactions/' || v_tx.id::text || '/reverse',
    201,
    v_tx.transaction_branch_id,
    'susu_collection_reversed',
    jsonb_build_object(
      'reason', v_reason,
      'originalTransactionId', v_tx.id,
      'reversalTransactionId', p_reversal_id,
      'amount', v_tx.amount,
      'customerId', v_tx.customer_id,
      'customerName', v_customer_name,
      'accountNumber', v_account,
      'branchId', v_tx.transaction_branch_id
    )
  );

  return jsonb_build_object(
    'reversalId', p_reversal_id,
    'originalId', v_tx.id,
    'amount', v_tx.amount,
    'balanceAfter', v_next,
    'customerName', v_customer_name,
    'accountNumber', v_account
  );
end;
$$;

revoke all on function public.reverse_susu_collection_atomic(uuid, text, uuid, text, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.reverse_susu_collection_atomic(uuid, text, uuid, text, text, text) to service_role;
  end if;
end $$;
