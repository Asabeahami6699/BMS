-- Rename product module core_banking → banking (department-style naming)

update public.tenant_modules
set module_key = 'banking'
where module_key = 'core_banking';

alter table public.tenant_modules
  drop constraint if exists tenant_modules_module_key_check;

alter table public.tenant_modules
  add constraint tenant_modules_module_key_check check (
    module_key in (
      'banking',
      'susu_management',
      'loans_credit',
      'fixed_deposit',
      'mobile_money'
    )
  );
