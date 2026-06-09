-- Branch-scoped bank products (null branch_id = available at all branches).

alter table public.tenant_bank_products
  add column if not exists branch_id text;

alter table public.tenant_bank_products
  drop constraint if exists tenant_bank_products_tenant_id_code_key;

create unique index if not exists tenant_bank_products_all_branches_code_uq
  on public.tenant_bank_products (tenant_id, code)
  where branch_id is null;

create unique index if not exists tenant_bank_products_branch_code_uq
  on public.tenant_bank_products (tenant_id, branch_id, code)
  where branch_id is not null;

create index if not exists tenant_bank_products_tenant_branch_idx
  on public.tenant_bank_products (tenant_id, branch_id, direction, is_active);
