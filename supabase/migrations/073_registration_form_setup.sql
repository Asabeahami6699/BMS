-- Per-company account registration forms. Null keeps the built-in defaults.

alter table public.tenants
  add column if not exists registration_form_config jsonb;
