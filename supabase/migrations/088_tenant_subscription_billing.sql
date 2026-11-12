-- Platform SaaS billing: plans, tenant periods, MoMo payment claims, reminders.

create table if not exists public.subscription_plans (
  id text primary key,
  name text not null,
  description text not null default '',
  interval text not null check (interval in ('month', 'year')),
  price_ghs numeric(12, 2) not null check (price_ghs >= 0),
  modules text[] not null default '{}',
  addons text[] not null default '{}',
  is_active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_billing_settings (
  id text primary key default 'default',
  momo_number text not null default '',
  momo_account_name text not null default '',
  momo_network text not null default 'MTN',
  reminder_days_before int not null default 3,
  grace_days int not null default 3,
  updated_at timestamptz not null default now(),
  constraint platform_billing_settings_singleton check (id = 'default')
);

insert into public.platform_billing_settings (id)
values ('default')
on conflict (id) do nothing;

alter table public.tenants
  add column if not exists plan_id text references public.subscription_plans (id) on delete set null,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists billing_status text not null default 'none';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenants_billing_status_check'
  ) then
    alter table public.tenants
      add constraint tenants_billing_status_check
      check (billing_status in ('none', 'active', 'due_soon', 'grace', 'suspended'));
  end if;
end $$;

create index if not exists tenants_period_end_idx on public.tenants (period_end);
create index if not exists tenants_billing_status_idx on public.tenants (billing_status);

create table if not exists public.subscription_payment_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants (id) on delete cascade,
  plan_id text not null references public.subscription_plans (id) on delete restrict,
  amount_ghs numeric(12, 2) not null check (amount_ghs >= 0),
  momo_reference text not null,
  payer_name text not null default '',
  payer_number text not null default '',
  notes text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  submitted_by text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists subscription_payment_claims_tenant_idx
  on public.subscription_payment_claims (tenant_id, created_at desc);
create index if not exists subscription_payment_claims_status_idx
  on public.subscription_payment_claims (status, created_at desc);

create table if not exists public.subscription_reminder_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants (id) on delete cascade,
  period_end date not null,
  reminder_kind text not null
    check (reminder_kind in ('due_minus_3', 'grace_day_1', 'grace_day_2_sms', 'grace_day_3_suspend')),
  channel text not null default 'in_app'
    check (channel in ('in_app', 'sms', 'system')),
  created_at timestamptz not null default now(),
  unique (tenant_id, period_end, reminder_kind)
);

create index if not exists subscription_reminder_log_tenant_idx
  on public.subscription_reminder_log (tenant_id, period_end);

insert into public.subscription_plans (id, name, description, interval, price_ghs, modules, addons, sort_order)
values
  (
    'plan-starter-month',
    'Starter Monthly',
    'Susu + Banking for growing cooperatives. Renew every month via MoMo.',
    'month',
    299.00,
    array['susu_management', 'banking'],
    array['sms_notifications', 'email_notifications'],
    10
  ),
  (
    'plan-growth-month',
    'Growth Monthly',
    'Susu, Banking, and Loans with multi-branch and SMS.',
    'month',
    599.00,
    array['susu_management', 'banking', 'loans_credit'],
    array['sms_notifications', 'email_notifications', 'multi_branch', 'mobile_money'],
    20
  ),
  (
    'plan-enterprise-year',
    'Enterprise Annual',
    'Full suite billed yearly — best value for established institutions.',
    'year',
    5999.00,
    array['susu_management', 'banking', 'loans_credit', 'treasury', 'investment_management'],
    array['sms_notifications', 'email_notifications', 'multi_branch', 'mobile_money', 'advanced_analytics', 'api_access'],
    30
  )
on conflict (id) do nothing;

-- subscription_payment_claims / subscription_reminder_log are purged by terminate_tenant catch-all (tenant_id).
