-- Terminate a tenant company and purge all tenant-scoped rows.
-- Ordered deletes respect FK dependencies; missing tables are skipped.

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
    -- Ledger / customer money trail
    'ledger_entries',
    'customer_transactions',
    'customer_balance_disclosures',
    'customer_partner_bank_accounts',
    -- Loans
    'loan_repayments',
    'loan_repayment_schedule',
    'loan_applications',
    'loan_group_members',
    'loan_groups',
    'loan_products',
    -- Investments
    'investment_attachments',
    'investment_beneficiaries',
    'investment_audit_log',
    'investments',
    'investment_form_configs',
    'investment_products',
    -- Field agent ops
    'field_agent_cash_variance_settlements',
    'field_agent_cash_variances',
    'field_agent_collection_batch_lines',
    'field_agent_collection_batches',
    'field_agent_withdrawal_fulfillment_lines',
    'field_agent_withdrawal_fulfillments',
    'field_agent_callover_reports',
    'susu_daily_closing_records',
    -- Float / till / treasury
    'branch_float_movements',
    'branch_float_sessions',
    'teller_till_journal_entries',
    'cash_movements',
    'branch_cash_accounts',
    -- Back office / agency
    'back_office_ecash_requests',
    'back_office_account_opening',
    'back_office_agent_transfers',
    'back_office_day_sessions',
    'tenant_bank_products',
    -- HR / ops
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
    -- Payroll
    'payslips',
    'user_payroll_profiles',
    'role_payroll_defaults',
    -- Messaging / audit / chat
    'agent_notifications',
    'sms_outbox',
    'email_outbox',
    'live_chat_messages',
    'live_chat_threads',
    'audit_logs',
    'api_idempotency_keys',
    -- Routes / customers / branches
    'field_routes',
    'customers',
    'branches',
    -- Auth / roles / settings
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

  -- Catch any remaining public tables with a tenant_id column.
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
