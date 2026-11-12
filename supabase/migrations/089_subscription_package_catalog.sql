-- Replace starter catalog with BMS commercial packages (monthly + setup fee + capacity).

alter table public.subscription_plans
  add column if not exists setup_fee_ghs numeric(12, 2) not null default 0,
  add column if not exists package_tier text not null default 'standard',
  add column if not exists max_branches int,
  add column if not exists max_staff int,
  add column if not exists max_field_agents int,
  add column if not exists max_active_customers int,
  add column if not exists feature_bullets text[] not null default '{}',
  add column if not exists is_custom boolean not null default false;

-- Retire previous seed plans (safe if unused; otherwise keep rows with FK refs).
update public.subscription_plans
set is_active = false
where id in ('plan-starter-month', 'plan-growth-month', 'plan-enterprise-year');

insert into public.subscription_plans (
  id, name, description, interval, price_ghs, setup_fee_ghs, package_tier,
  modules, addons, feature_bullets,
  max_branches, max_staff, max_field_agents, max_active_customers,
  is_custom, is_active, sort_order
)
values
  (
    'pkg-susu-starter',
    'BMS Susu Starter',
    'Entry package for single-branch Susu operations. Monthly fee covers the platform seat; SMS is billed separately per message when the SMS add-on is used.',
    'month',
    399.00,
    500.00,
    'entry',
    array['susu_management'],
    array['email_notifications'],
    array[
      '1 branch',
      '5 staff',
      '5 field agents',
      '500 active customers',
      'Susu collections, callover, withdrawals, float management and basic reports',
      'SMS alerts billed separately per message (Arkesel)'
    ],
    1, 5, 5, 500,
    false, true, 10
  ),
  (
    'pkg-susu-professional',
    'BMS Susu Professional',
    'Growing Susu business package with stronger controls and reporting. SMS remains usage-based on top of the monthly package.',
    'month',
    699.00,
    750.00,
    'growing',
    array['susu_management'],
    array['email_notifications', 'sms_notifications', 'multi_branch', 'advanced_analytics'],
    array[
      '3 branches',
      '15 staff',
      '20 field agents',
      '1,500 active customers',
      'Advanced reporting, reconciliation, performance tracking, group savings and enhanced controls',
      'SMS alerts billed separately per message (Arkesel)'
    ],
    3, 15, 20, 1500,
    false, true, 20
  ),
  (
    'pkg-financial-plus',
    'BMS Financial Plus',
    'Multi-product package for Susu + Agency Banking + Loans with shared customers and ledger.',
    'month',
    1199.00,
    1200.00,
    'multi_product',
    array['susu_management', 'banking', 'loans_credit', 'treasury'],
    array['email_notifications', 'sms_notifications', 'multi_branch', 'mobile_money', 'advanced_analytics'],
    array[
      '5 branches',
      '25 staff',
      '40 field agents',
      '2,500 active customers',
      'Susu, Agency Banking, Loans, shared customers and ledger, plus basic Treasury',
      'SMS alerts billed separately per message (Arkesel)'
    ],
    5, 25, 40, 2500,
    false, true, 30
  ),
  (
    'pkg-financial-institution',
    'BMS Financial Institution',
    'Institution package with full product suite, operations and audit workspaces.',
    'month',
    1999.00,
    2000.00,
    'institution',
    array['susu_management', 'banking', 'loans_credit', 'treasury', 'investment_management'],
    array[
      'email_notifications', 'sms_notifications', 'multi_branch', 'mobile_money',
      'advanced_analytics', 'api_access', 'bulk_import', 'custom_branding'
    ],
    array[
      '10 branches',
      '50 staff',
      '100 field agents',
      '3,500 active customers',
      'Susu, Agency Banking, Loans, Investments, full Treasury, Operations, advanced reports and audit workspaces',
      'SMS alerts billed separately per message (Arkesel)'
    ],
    10, 50, 100, 3500,
    false, true, 40
  ),
  (
    'pkg-enterprise',
    'BMS Enterprise',
    'Custom contract for large deployments — capacity, integrations, migration and SLAs agreed in writing. Listed price is a starting monthly floor.',
    'month',
    3000.00,
    5000.00,
    'enterprise',
    array['susu_management', 'banking', 'loans_credit', 'treasury', 'investment_management'],
    array[
      'email_notifications', 'sms_notifications', 'multi_branch', 'mobile_money',
      'advanced_analytics', 'api_access', 'bulk_import', 'custom_branding'
    ],
    array[
      'Custom branches, staff and customer capacity',
      'Custom integrations and onboarding',
      'Data migration and dedicated support arrangements',
      'Contract-specific service levels',
      'SMS alerts billed separately per message (Arkesel)'
    ],
    null, null, null, null,
    true, true, 50
  )
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  interval = excluded.interval,
  price_ghs = excluded.price_ghs,
  setup_fee_ghs = excluded.setup_fee_ghs,
  package_tier = excluded.package_tier,
  modules = excluded.modules,
  addons = excluded.addons,
  feature_bullets = excluded.feature_bullets,
  max_branches = excluded.max_branches,
  max_staff = excluded.max_staff,
  max_field_agents = excluded.max_field_agents,
  max_active_customers = excluded.max_active_customers,
  is_custom = excluded.is_custom,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;
