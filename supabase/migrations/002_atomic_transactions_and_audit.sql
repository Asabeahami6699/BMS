-- Atomic transaction + ledger write and audit table.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  actor_user_id text,
  actor_role text,
  method text not null,
  path text not null,
  status_code integer not null,
  branch_id uuid references public.branches(id),
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_tenant_created on public.audit_logs(tenant_id, created_at desc);

alter table public.audit_logs enable row level security;

create policy audit_logs_select on public.audit_logs
for select
using (
  tenant_id = public.jwt_tenant_id()
  and public.jwt_scope_type() = 'head_office'
);

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
  v_customer_id uuid;
begin
  if p_type not in ('daily_susu', 'deposit', 'withdrawal') then
    raise exception 'Invalid transaction type: %', p_type;
  end if;

  v_entry_type := case when p_type = 'withdrawal' then 'debit' else 'credit' end;

  select id
  into v_customer_id
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

  if p_type = 'withdrawal' and v_balance < p_amount then
    raise exception 'Insufficient balance';
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

revoke all on function public.post_customer_transaction_atomic(
  uuid, text, uuid, text, numeric, uuid, uuid, text, text, text
) from public;
