-- Formal internal allocation of accumulated institutional / commission income
-- from branch_income_accounts into branch_capital_entries (Business Capital).
--
-- Accounting invariant:
--   Commission physical cash is ALREADY inside the branch vault/safe when fees
--   are collected. Therefore an allocation uses entry_type = 'income_allocation'
--   (non-cash equity reclassification):
--     - Debits branch_income_accounts.balance
--     - Credits branch_capital_entries (increases branchNetCapital / companyNetCapital)
--     - Adds GHS 0.00 to physical dayInjections / expectedClosingVault

-- 1. Extend branch_capital_entries to support non-cash 'income_allocation' entries
--    and trace them back to the source branch_income_accounts record.
do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.branch_capital_entries'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%entry_type%'
  loop
    execute format('alter table public.branch_capital_entries drop constraint %I', v_constraint);
  end loop;
end $$;

alter table public.branch_capital_entries
  add constraint branch_capital_entries_entry_type_check
  check (entry_type in ('injection', 'drawing', 'income_allocation'));

alter table public.branch_capital_entries
  add column if not exists income_account_id uuid references public.branch_income_accounts (id),
  add column if not exists idempotency_key text;

create unique index if not exists uq_branch_capital_entries_idempotency
  on public.branch_capital_entries (tenant_id, idempotency_key)
  where idempotency_key is not null;

-- 2. Dedicated audit & transfer ledger linking branch_income_accounts -> branch_capital_entries.
create table if not exists public.institutional_income_capital_transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  branch_id text not null,
  income_account_id uuid not null references public.branch_income_accounts (id),
  capital_entry_id uuid not null unique references public.branch_capital_entries (id),
  amount numeric(18, 2) not null check (amount > 0),
  business_date date not null default (current_date),
  reference text not null,
  idempotency_key text not null,
  notes text,
  authorized_by_user_id text not null,
  authorized_by_name text,
  reversed_at timestamptz,
  reversed_by_user_id text,
  reversed_by_name text,
  reversal_reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_income_capital_transfers_idempotency
  on public.institutional_income_capital_transfers (tenant_id, idempotency_key);

create index if not exists idx_income_capital_transfers_tenant_branch_date
  on public.institutional_income_capital_transfers (tenant_id, branch_id, business_date desc, created_at desc);

create index if not exists idx_income_capital_transfers_tenant_created
  on public.institutional_income_capital_transfers (tenant_id, created_at desc);

alter table public.institutional_income_capital_transfers enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'institutional_income_capital_transfers'
      and policyname = 'income_capital_transfers_select'
  ) then
    create policy income_capital_transfers_select
      on public.institutional_income_capital_transfers
      for select using (tenant_id = public.jwt_tenant_id());
  end if;
end $$;

comment on table public.institutional_income_capital_transfers is
  'Atomic, idempotent transfers allocating accumulated branch institutional/commission income into Business Capital without adding physical vault cash.';

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.institutional_income_capital_transfers;
    exception when duplicate_object then
      null;
    end;
  end if;
end $$;

-- 3. Atomic RPC: debit branch_income_accounts & credit branch_capital_entries in one transaction.
create or replace function public.transfer_institutional_income_to_capital_atomic(
  p_transfer_id uuid,
  p_capital_entry_id uuid,
  p_tenant_id text,
  p_branch_id text,
  p_amount numeric,
  p_business_date date,
  p_reference text,
  p_notes text,
  p_idempotency_key text,
  p_authorized_by_user_id text,
  p_authorized_by_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.branch_income_accounts%rowtype;
  v_existing public.institutional_income_capital_transfers%rowtype;
  v_transfer public.institutional_income_capital_transfers%rowtype;
  v_capital public.branch_capital_entries%rowtype;
  v_amount numeric(18, 2);
  v_prev_balance numeric(18, 2);
  v_new_balance numeric(18, 2);
  v_ref text;
  v_notes text;
  v_now timestamptz := now();
begin
  if p_tenant_id is null or length(trim(p_tenant_id)) = 0 then
    raise exception 'Tenant is required';
  end if;
  if p_branch_id is null or length(trim(p_branch_id)) = 0 then
    raise exception 'Branch is required';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;

  v_amount := round(coalesce(p_amount, 0), 2);
  if v_amount <= 0 then
    raise exception 'Transfer amount must be greater than zero';
  end if;

  -- Lock the branch income account row first to serialize concurrent transfers for this branch.
  select *
  into v_account
  from public.branch_income_accounts
  where tenant_id = p_tenant_id
    and branch_id = p_branch_id
    and is_active = true
  for update;

  -- Re-check idempotency under lock so concurrent retries cannot duplicate.
  select *
  into v_existing
  from public.institutional_income_capital_transfers
  where tenant_id = p_tenant_id
    and idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    return jsonb_build_object(
      'idempotent', true,
      'transfer', to_jsonb(v_existing),
      'previous_balance', coalesce(v_account.balance, 0),
      'new_balance', coalesce(v_account.balance, 0),
      'income_account_label', coalesce(v_account.label, '')
    );
  end if;

  if v_account.id is null then
    raise exception 'Active institutional income account not found for this branch';
  end if;

  v_prev_balance := round(coalesce(v_account.balance, 0), 2);
  if v_amount > v_prev_balance then
    raise exception 'Transfer amount (GHS %) exceeds available institutional income balance (GHS %)',
      to_char(v_amount, 'FM999999999990.00'),
      to_char(v_prev_balance, 'FM999999999990.00');
  end if;

  v_new_balance := round(v_prev_balance - v_amount, 2);
  v_ref := nullif(trim(coalesce(p_reference, '')), '');
  if v_ref is null then
    v_ref := 'INC-CAP-' || to_char(coalesce(p_business_date, current_date), 'YYYYMMDD') || '-' || upper(left(replace(p_transfer_id::text, '-', ''), 6));
  end if;
  v_notes := nullif(trim(coalesce(p_notes, '')), '');

  -- 1. Debit available institutional income balance.
  update public.branch_income_accounts
  set balance = v_new_balance,
      updated_at = v_now
  where id = v_account.id
    and tenant_id = p_tenant_id;

  -- 2. Record non-cash capital allocation in branch_capital_entries.
  insert into public.branch_capital_entries (
    id,
    tenant_id,
    branch_id,
    business_date,
    entry_type,
    amount,
    source,
    reference,
    notes,
    recorded_by,
    recorded_by_name,
    income_account_id,
    idempotency_key,
    created_at
  )
  values (
    p_capital_entry_id,
    p_tenant_id,
    p_branch_id,
    coalesce(p_business_date, current_date),
    'income_allocation',
    v_amount,
    'Commission income allocation (' || v_account.label || ')',
    v_ref,
    coalesce(v_notes, 'Internal allocation from institutional commission income to Business Capital (non-cash)'),
    p_authorized_by_user_id,
    nullif(trim(coalesce(p_authorized_by_name, '')), ''),
    v_account.id,
    'income_transfer:' || p_idempotency_key,
    v_now
  )
  returning * into v_capital;

  -- 3. Record linked transfer audit entry.
  insert into public.institutional_income_capital_transfers (
    id,
    tenant_id,
    branch_id,
    income_account_id,
    capital_entry_id,
    amount,
    business_date,
    reference,
    idempotency_key,
    notes,
    authorized_by_user_id,
    authorized_by_name,
    created_at
  )
  values (
    p_transfer_id,
    p_tenant_id,
    p_branch_id,
    v_account.id,
    v_capital.id,
    v_amount,
    coalesce(p_business_date, current_date),
    v_ref,
    p_idempotency_key,
    v_notes,
    p_authorized_by_user_id,
    nullif(trim(coalesce(p_authorized_by_name, '')), ''),
    v_now
  )
  returning * into v_transfer;

  return jsonb_build_object(
    'idempotent', false,
    'transfer', to_jsonb(v_transfer),
    'capital_entry', to_jsonb(v_capital),
    'previous_balance', v_prev_balance,
    'new_balance', v_new_balance,
    'income_account_label', v_account.label
  );
end;
$$;

-- 4. Atomic RPC: reverse a commission income -> capital transfer and restore income balance.
create or replace function public.reverse_institutional_income_capital_transfer_atomic(
  p_tenant_id text,
  p_transfer_id uuid,
  p_actor_user_id text,
  p_actor_name text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer public.institutional_income_capital_transfers%rowtype;
  v_account public.branch_income_accounts%rowtype;
  v_capital public.branch_capital_entries%rowtype;
  v_reason text;
  v_prev_balance numeric(18, 2);
  v_new_balance numeric(18, 2);
  v_now timestamptz := now();
begin
  v_reason := trim(coalesce(p_reason, ''));
  if length(v_reason) < 3 then
    raise exception 'Enter a reversal reason (at least 3 characters)';
  end if;

  select *
  into v_transfer
  from public.institutional_income_capital_transfers
  where tenant_id = p_tenant_id
    and id = p_transfer_id
  for update;

  if v_transfer.id is null then
    raise exception 'Commission capital transfer not found';
  end if;

  if v_transfer.reversed_at is not null then
    raise exception 'This commission capital transfer has already been reversed';
  end if;

  select *
  into v_account
  from public.branch_income_accounts
  where id = v_transfer.income_account_id
    and tenant_id = p_tenant_id
  for update;

  if v_account.id is null then
    raise exception 'Linked branch income account not found';
  end if;

  select *
  into v_capital
  from public.branch_capital_entries
  where id = v_transfer.capital_entry_id
    and tenant_id = p_tenant_id
  for update;

  v_prev_balance := round(coalesce(v_account.balance, 0), 2);
  v_new_balance := round(v_prev_balance + v_transfer.amount, 2);

  -- 1. Restore available institutional income balance.
  update public.branch_income_accounts
  set balance = v_new_balance,
      updated_at = v_now
  where id = v_account.id
    and tenant_id = p_tenant_id;

  -- 2. Void linked capital allocation entry (non-cash).
  if v_capital.id is not null and v_capital.voided_at is null then
    update public.branch_capital_entries
    set voided_at = v_now,
        voided_by = p_actor_user_id,
        void_reason = 'Commission transfer reversed: ' || v_reason
    where id = v_capital.id
      and tenant_id = p_tenant_id;
  end if;

  -- 3. Mark transfer as reversed with audit metadata.
  update public.institutional_income_capital_transfers
  set reversed_at = v_now,
      reversed_by_user_id = p_actor_user_id,
      reversed_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
      reversal_reason = v_reason
  where id = v_transfer.id
    and tenant_id = p_tenant_id
  returning * into v_transfer;

  return jsonb_build_object(
    'transfer', to_jsonb(v_transfer),
    'previous_balance', v_prev_balance,
    'new_balance', v_new_balance,
    'income_account_label', v_account.label
  );
end;
$$;
