alter table public.tenant_roles
  add column if not exists role_kind text not null default 'extra_duties'
  check (role_kind in ('job_title', 'extra_duties'));

comment on column public.tenant_roles.role_kind is
  'job_title = primary users.role value; extra_duties = optional duty bundle via user_role_assignments';
