-- Allow curated Field Agent mobile-app capability toggles (and Back Officer)
-- to be persisted in tenant_builtin_role_overrides.

alter table public.tenant_builtin_role_overrides
  drop constraint if exists tenant_builtin_role_overrides_role_check;

alter table public.tenant_builtin_role_overrides
  add constraint tenant_builtin_role_overrides_role_check
    check (
      role in (
        'admin',
        'coordinator',
        'teller',
        'back_officer',
        'accountant',
        'auditor',
        'customer_service',
        'field_agent'
      )
    );
