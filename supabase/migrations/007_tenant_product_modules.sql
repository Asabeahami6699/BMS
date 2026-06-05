create table if not exists public.tenant_modules (
  tenant_id text not null references public.tenants (id) on delete cascade,
  module_key text not null check (
    module_key in (
      'core_banking',
      'susu_management',
      'loans_credit',
      'fixed_deposit',
      'mobile_money'
    )
  ),
  primary key (tenant_id, module_key)
);

create index if not exists tenant_modules_tenant_idx on public.tenant_modules (tenant_id);

-- Demo tenant defaults (optional; safe if tenant missing)
insert into public.tenant_modules (tenant_id, module_key)
values
  ('tenant-demo', 'core_banking'),
  ('tenant-demo', 'susu_management')
on conflict do nothing;
