-- Enable Supabase Realtime for every public table created by BMS migrations.
-- Idempotent: skips tables already in the publication / missing relations.
-- Also sets REPLICA IDENTITY FULL so UPDATE/DELETE payloads include row data.

do $$
declare
  tbl text;
  tables text[] := array[
    'agent_notifications',
    'api_idempotency_keys',
    'audit_logs',
    'back_office_account_opening',
    'back_office_agent_transfers',
    'back_office_day_sessions',
    'back_office_ecash_requests',
    'branch_cash_accounts',
    'branch_float_movements',
    'branch_float_sessions',
    'branches',
    'cash_movements',
    'company_announcement_acks',
    'company_announcements',
    'company_documents',
    'customer_balance_disclosures',
    'customer_partner_bank_accounts',
    'customer_transactions',
    'customers',
    'email_outbox',
    'field_agent_callover_reports',
    'field_agent_cash_variance_settlements',
    'field_agent_cash_variances',
    'field_agent_collection_batch_lines',
    'field_agent_collection_batches',
    'field_agent_withdrawal_fulfillment_lines',
    'field_agent_withdrawal_fulfillments',
    'field_routes',
    'hr_attendance_records',
    'hr_leave_requests',
    'hr_policies',
    'hr_role_leave_entitlements',
    'hr_staff_loans',
    'hr_training_records',
    'incident_reports',
    'investment_attachments',
    'investment_audit_log',
    'investment_beneficiaries',
    'investment_form_configs',
    'investment_products',
    'investments',
    'ledger_entries',
    'live_chat_messages',
    'live_chat_threads',
    'loan_applications',
    'loan_group_members',
    'loan_groups',
    'loan_products',
    'loan_repayment_schedule',
    'loan_repayments',
    'payslips',
    'role_payroll_defaults',
    'sms_outbox',
    'susu_daily_closing_records',
    'teller_till_journal_entries',
    'tenant_addons',
    'tenant_bank_products',
    'tenant_builtin_role_overrides',
    'tenant_email_settings',
    'tenant_modules',
    'tenant_roles',
    'tenant_sms_settings',
    'tenant_susu_nav_overrides',
    'tenants',
    'user_payroll_profiles',
    'user_role_assignments',
    'users'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publication supabase_realtime not found — skip realtime enablement';
    return;
  end if;

  foreach tbl in array tables
  loop
    if to_regclass(format('public.%I', tbl)) is null then
      continue;
    end if;

    begin
      execute format('alter table public.%I replica identity full', tbl);
    exception
      when others then
        raise notice 'replica identity skipped for %: %', tbl, sqlerrm;
    end;

    if exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = tbl
    ) then
      continue;
    end if;

    begin
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    exception
      when duplicate_object then
        null;
      when undefined_table then
        null;
      when others then
        raise notice 'realtime add skipped for %: %', tbl, sqlerrm;
    end;
  end loop;

  -- Catch any other public base tables created later that we missed in the list above.
  for tbl in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname not like 'pg_%'
      and not exists (
        select 1
        from pg_publication_tables pt
        where pt.pubname = 'supabase_realtime'
          and pt.schemaname = 'public'
          and pt.tablename = c.relname
      )
  loop
    begin
      execute format('alter table public.%I replica identity full', tbl);
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    exception
      when duplicate_object then
        null;
      when others then
        raise notice 'realtime catch-all skipped for %: %', tbl, sqlerrm;
    end;
  end loop;
end $$;
