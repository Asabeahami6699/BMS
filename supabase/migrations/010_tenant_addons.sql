-- Tenant add-ons (premium features assigned by platform super admin)

create table if not exists public.tenant_addons (
  tenant_id text not null references public.tenants (id) on delete cascade,
  addon_key text not null check (
    addon_key in (
      'mobile_money',
      'sms_notifications',
      'email_notifications',
      'api_access',
      'multi_branch',
      'advanced_analytics',
      'bulk_import',
      'custom_branding'
    )
  ),
  primary key (tenant_id, addon_key)
);

create index if not exists tenant_addons_tenant_idx on public.tenant_addons (tenant_id);

insert into public.tenant_modules (tenant_id, module_key)
select tenant_id, 'treasury'
from public.tenant_modules
where module_key = 'fixed_deposit'
on conflict do nothing;

insert into public.tenant_addons (tenant_id, addon_key)
select tenant_id, 'mobile_money'
from public.tenant_modules
where module_key = 'mobile_money'
on conflict do nothing;

delete from public.tenant_modules
where module_key in ('mobile_money', 'fixed_deposit');

alter table public.tenant_modules
  drop constraint if exists tenant_modules_module_key_check;

alter table public.tenant_modules
  add constraint tenant_modules_module_key_check check (
    module_key in (
      'banking',
      'susu_management',
      'loans_credit',
      'treasury'
    )
  );
