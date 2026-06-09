alter table public.tenant_roles
  add column if not exists product_scope text not null default 'all';

comment on column public.tenant_roles.product_scope is
  'Custom role product scope: all = duties may span subscribed products; otherwise one tenant module key (susu_management, loans_credit, banking, treasury).';
