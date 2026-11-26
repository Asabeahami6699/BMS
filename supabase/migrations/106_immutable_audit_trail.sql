-- Financial-institution-grade Audit Trail & Compliance:
-- 1. Structured before/after financial field snapshots, entity references, changed fields, and metadata.
-- 2. Monotonic per-tenant sequence numbers + cryptographic SHA-256 hash chain sealed inside PostgreSQL.
-- 3. DB-level append-only immutability trigger blocking UPDATE and DELETE on public.audit_logs
--    (with a transaction-local guard reserved exclusively for platform terminate_tenant()).
-- 4. Server-side verify_audit_log_chain(tenant_id) RPC to cryptographically prove log integrity.

create extension if not exists pgcrypto;

alter table public.audit_logs
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists before_snapshot jsonb,
  add column if not exists after_snapshot jsonb,
  add column if not exists changed_fields text[],
  add column if not exists metadata jsonb,
  add column if not exists seq_no bigint,
  add column if not exists prev_hash text,
  add column if not exists entry_hash text;

create unique index if not exists idx_audit_tenant_seq_uidx
  on public.audit_logs (tenant_id, seq_no)
  where seq_no is not null;

create index if not exists idx_audit_tenant_entity
  on public.audit_logs (tenant_id, entity_type, entity_id, created_at desc)
  where entity_type is not null;

-- Canonical SHA-256 digest used by both the sealing trigger and verify_audit_log_chain().
create or replace function public.compute_audit_log_hash(
  p_tenant_id text,
  p_seq_no bigint,
  p_created_at timestamptz,
  p_actor_user_id text,
  p_actor_role text,
  p_method text,
  p_path text,
  p_action text,
  p_status_code integer,
  p_branch_id uuid,
  p_ip_address text,
  p_entity_type text,
  p_entity_id text,
  p_before_snapshot jsonb,
  p_after_snapshot jsonb,
  p_changed_fields text[],
  p_metadata jsonb,
  p_prev_hash text
)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(
    digest(
      concat_ws(
        '|',
        coalesce(p_tenant_id, ''),
        coalesce(p_seq_no::text, ''),
        coalesce(to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
        coalesce(p_actor_user_id, ''),
        coalesce(p_actor_role, ''),
        coalesce(p_method, ''),
        coalesce(p_path, ''),
        coalesce(p_action, ''),
        coalesce(p_status_code::text, ''),
        coalesce(p_branch_id::text, ''),
        coalesce(p_ip_address, ''),
        coalesce(p_entity_type, ''),
        coalesce(p_entity_id, ''),
        coalesce(p_before_snapshot::text, ''),
        coalesce(p_after_snapshot::text, ''),
        coalesce(array_to_string(p_changed_fields, ','), ''),
        coalesce(p_metadata::text, ''),
        coalesce(p_prev_hash, '')
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- Serialize inserts per tenant and seal monotonic seq_no + SHA-256 hash chain.
create or replace function public.audit_logs_chain_seal_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_last_seq bigint;
  v_last_hash text;
begin
  perform pg_advisory_xact_lock(hashtext('audit_chain:' || coalesce(new.tenant_id, '')));

  select seq_no, entry_hash
  into v_last_seq, v_last_hash
  from public.audit_logs
  where tenant_id = new.tenant_id
    and seq_no is not null
  order by seq_no desc
  limit 1;

  new.created_at := coalesce(new.created_at, now());
  new.seq_no := coalesce(v_last_seq, 0) + 1;
  new.prev_hash := coalesce(v_last_hash, 'GENESIS');
  new.entry_hash := public.compute_audit_log_hash(
    new.tenant_id,
    new.seq_no,
    new.created_at,
    new.actor_user_id,
    new.actor_role,
    new.method,
    new.path,
    new.action,
    new.status_code,
    new.branch_id,
    new.ip_address,
    new.entity_type,
    new.entity_id,
    new.before_snapshot,
    new.after_snapshot,
    new.changed_fields,
    new.metadata,
    new.prev_hash
  );

  return new;
end;
$$;

drop trigger if exists trg_audit_logs_chain_seal on public.audit_logs;
create trigger trg_audit_logs_chain_seal
before insert on public.audit_logs
for each row
execute function public.audit_logs_chain_seal_trigger();

-- Enforce append-only immutability: block all UPDATE and DELETE operations on audit_logs.
create or replace function public.audit_logs_append_only_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('bms.allow_audit_purge_for_tenant_termination', true) = 'on' then
    return old;
  end if;

  raise exception 'audit_logs is append-only and immutable (% is prohibited)', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_audit_logs_append_only on public.audit_logs;
create trigger trg_audit_logs_append_only
before update or delete on public.audit_logs
for each row
execute function public.audit_logs_append_only_trigger();

-- Re-verify every sealed audit log entry for a tenant (monotonic sequence, prev_hash linkage, SHA-256 recompute).
create or replace function public.verify_audit_log_chain(p_tenant_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  rec record;
  v_expected_seq bigint := 1;
  v_expected_prev text := 'GENESIS';
  v_expected_hash text;
  v_checked bigint := 0;
  v_legacy bigint := 0;
  v_latest_seq bigint := null;
  v_latest_hash text := null;
begin
  select count(*)
  into v_legacy
  from public.audit_logs
  where tenant_id = p_tenant_id
    and seq_no is null;

  for rec in
    select
      id,
      tenant_id,
      seq_no,
      created_at,
      actor_user_id,
      actor_role,
      method,
      path,
      action,
      status_code,
      branch_id,
      ip_address,
      entity_type,
      entity_id,
      before_snapshot,
      after_snapshot,
      changed_fields,
      metadata,
      prev_hash,
      entry_hash
    from public.audit_logs
    where tenant_id = p_tenant_id
      and seq_no is not null
    order by seq_no asc
  loop
    if rec.seq_no <> v_expected_seq then
      return jsonb_build_object(
        'valid', false,
        'checkedCount', v_checked,
        'legacyUnchainedCount', v_legacy,
        'latestSeqNo', v_latest_seq,
        'latestHash', v_latest_hash,
        'brokenSeqNo', rec.seq_no,
        'brokenId', rec.id,
        'reason', format('Sequence gap detected: expected #%s but found #%s', v_expected_seq, rec.seq_no),
        'verifiedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      );
    end if;

    if coalesce(rec.prev_hash, '') <> v_expected_prev then
      return jsonb_build_object(
        'valid', false,
        'checkedCount', v_checked,
        'legacyUnchainedCount', v_legacy,
        'latestSeqNo', v_latest_seq,
        'latestHash', v_latest_hash,
        'brokenSeqNo', rec.seq_no,
        'brokenId', rec.id,
        'reason', format('Hash chain link mismatch at sequence #%s', rec.seq_no),
        'verifiedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      );
    end if;

    v_expected_hash := public.compute_audit_log_hash(
      rec.tenant_id,
      rec.seq_no,
      rec.created_at,
      rec.actor_user_id,
      rec.actor_role,
      rec.method,
      rec.path,
      rec.action,
      rec.status_code,
      rec.branch_id,
      rec.ip_address,
      rec.entity_type,
      rec.entity_id,
      rec.before_snapshot,
      rec.after_snapshot,
      rec.changed_fields,
      rec.metadata,
      rec.prev_hash
    );

    if coalesce(rec.entry_hash, '') <> v_expected_hash then
      return jsonb_build_object(
        'valid', false,
        'checkedCount', v_checked,
        'legacyUnchainedCount', v_legacy,
        'latestSeqNo', v_latest_seq,
        'latestHash', v_latest_hash,
        'brokenSeqNo', rec.seq_no,
        'brokenId', rec.id,
        'reason', format('Entry digest mismatch (tampering detected) at sequence #%s', rec.seq_no),
        'verifiedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      );
    end if;

    v_checked := v_checked + 1;
    v_latest_seq := rec.seq_no;
    v_latest_hash := rec.entry_hash;
    v_expected_prev := rec.entry_hash;
    v_expected_seq := v_expected_seq + 1;
  end loop;

  return jsonb_build_object(
    'valid', true,
    'checkedCount', v_checked,
    'legacyUnchainedCount', v_legacy,
    'latestSeqNo', v_latest_seq,
    'latestHash', v_latest_hash,
    'verifiedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;

revoke all on function public.verify_audit_log_chain(text) from public;
grant execute on function public.verify_audit_log_chain(text) to service_role;

-- Update terminate_tenant() so platform-level tenant termination sets the transaction-local
-- purge flag before deleting a terminated tenant's rows while keeping audit_logs immutable everywhere else.
create or replace function public.terminate_tenant(p_tenant_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tbl text;
  deleted_total bigint := 0;
  n bigint;
  tables text[] := array[
    'ledger_entries',
    'customer_transactions',
    'customer_balance_disclosures',
    'customer_partner_bank_accounts',
    'loan_repayments',
    'loan_repayment_schedule',
    'loan_applications',
    'loan_group_members',
    'loan_groups',
    'loan_products',
    'investment_attachments',
    'investment_beneficiaries',
    'investment_audit_log',
    'investments',
    'investment_form_configs',
    'investment_products',
    'field_agent_cash_variance_settlements',
    'field_agent_cash_variances',
    'field_agent_collection_batch_lines',
    'field_agent_collection_batches',
    'field_agent_withdrawal_fulfillment_lines',
    'field_agent_withdrawal_fulfillments',
    'field_agent_callover_reports',
    'susu_daily_closing_records',
    'branch_float_movements',
    'branch_float_sessions',
    'teller_till_journal_entries',
    'cash_movements',
    'branch_cash_accounts',
    'institutional_income_entries',
    'branch_income_accounts',
    'susu_customer_cycles',
    'susu_commission_policies',
    'back_office_ecash_requests',
    'back_office_account_opening',
    'back_office_agent_transfers',
    'back_office_day_sessions',
    'tenant_bank_products',
    'hr_staff_loans',
    'hr_training_records',
    'hr_attendance_records',
    'hr_leave_requests',
    'hr_role_leave_entitlements',
    'hr_policies',
    'company_announcement_acks',
    'company_announcements',
    'company_documents',
    'incident_reports',
    'payslips',
    'user_payroll_profiles',
    'role_payroll_defaults',
    'agent_notifications',
    'sms_outbox',
    'email_outbox',
    'live_chat_messages',
    'live_chat_threads',
    'audit_logs',
    'api_idempotency_keys',
    'field_routes',
    'customers',
    'branches',
    'user_role_assignments',
    'tenant_roles',
    'tenant_builtin_role_overrides',
    'tenant_susu_nav_overrides',
    'tenant_sms_settings',
    'tenant_email_settings',
    'tenant_addons',
    'tenant_modules',
    'users'
  ];
begin
  if p_tenant_id is null or length(trim(p_tenant_id)) = 0 then
    raise exception 'tenant id is required';
  end if;

  if p_tenant_id = 'platform' then
    raise exception 'cannot terminate the platform tenant';
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'tenant not found';
  end if;

  perform set_config('bms.allow_audit_purge_for_tenant_termination', 'on', true);

  foreach tbl in array tables
  loop
    if to_regclass(format('public.%I', tbl)) is null then
      continue;
    end if;
    begin
      execute format('delete from public.%I where tenant_id = $1', tbl)
        using p_tenant_id;
      get diagnostics n = row_count;
      deleted_total := deleted_total + coalesce(n, 0);
    exception
      when undefined_table then
        null;
      when undefined_column then
        null;
      when others then
        raise notice 'terminate_tenant skip %: %', tbl, sqlerrm;
    end;
  end loop;

  for tbl in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind = 'r'
      and a.attname = 'tenant_id'
      and a.attnum > 0
      and not a.attisdropped
      and c.relname <> 'tenants'
      and not (c.relname = any (tables))
  loop
    begin
      execute format('delete from public.%I where tenant_id = $1', tbl)
        using p_tenant_id;
      get diagnostics n = row_count;
      deleted_total := deleted_total + coalesce(n, 0);
    exception
      when others then
        raise notice 'terminate_tenant catch-all skip %: %', tbl, sqlerrm;
    end;
  end loop;

  delete from public.tenants where id = p_tenant_id;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'tenant row was not deleted';
  end if;

  return jsonb_build_object(
    'tenantId', p_tenant_id,
    'deletedRows', deleted_total,
    'tenantDeleted', true
  );
end;
$$;

revoke all on function public.terminate_tenant(text) from public;
grant execute on function public.terminate_tenant(text) to service_role;
