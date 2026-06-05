-- Platform system tenant and demo cooperative for auth profiles.
-- Auth users (super@bms.com, admin@demo.com) are linked on API startup via service role.

insert into public.tenants (id, name, subscription_status)
values ('platform', 'BMS Platform', 'active')
on conflict (id) do nothing;

insert into public.tenants (id, name, subscription_status)
values ('tenant-demo', 'Demo Cooperative', 'active')
on conflict (id) do nothing;

insert into public.tenant_modules (tenant_id, module_key)
values
  ('tenant-demo', 'banking'),
  ('tenant-demo', 'susu_management')
on conflict (tenant_id, module_key) do nothing;
