-- Allow investment_management as a tenant product module key.

alter table public.tenant_modules
  drop constraint if exists tenant_modules_module_key_check;

alter table public.tenant_modules
  add constraint tenant_modules_module_key_check check (
    module_key in (
      'banking',
      'susu_management',
      'loans_credit',
      'treasury',
      'investment_management'
    )
  );

comment on column public.tenant_roles.product_scope is
  'Custom role product scope: all = duties may span subscribed products; otherwise one tenant module key (susu_management, loans_credit, banking, treasury, investment_management).';
