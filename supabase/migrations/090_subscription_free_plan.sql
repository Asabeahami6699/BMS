-- Free package: one-month site access with capacity limits; SMS remains usage-paid.

insert into public.subscription_plans (
  id, name, description, interval, price_ghs, setup_fee_ghs, package_tier,
  modules, addons, feature_bullets,
  max_branches, max_staff, max_field_agents, max_active_customers,
  is_custom, is_active, sort_order
)
values
  (
    'pkg-free',
    'BMS Free',
    'Free one-month access to core Susu site resources. No package or setup fee — you only pay SMS usage when you send messages. Capacity limits apply for the free month.',
    'month',
    0.00,
    0.00,
    'free',
    array['susu_management'],
    array['email_notifications', 'sms_notifications'],
    array[
      '1 branch',
      '10 staff / users',
      '10 mobilizers (field agents)',
      '1,000 active customers',
      'Unlimited platform usage for one month within those limits',
      'Pay only for SMS usage (Arkesel) — no monthly package fee'
    ],
    1, 10, 10, 1000,
    false, true, 5
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
