-- Tenant-configurable agency banking products (e.g. Ecobank deposit, GCB withdrawal).

create table if not exists public.tenant_bank_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  name text not null,
  code text not null,
  direction text not null check (direction in ('deposit', 'withdrawal')),
  bank_label text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index if not exists tenant_bank_products_tenant_direction_idx
  on public.tenant_bank_products (tenant_id, direction, is_active, sort_order);

alter table public.customer_transactions
  add column if not exists bank_product_id uuid references public.tenant_bank_products (id);

create index if not exists idx_transactions_bank_product
  on public.customer_transactions (tenant_id, bank_product_id)
  where bank_product_id is not null;

alter table public.customer_balance_disclosures
  add column if not exists bank_product_id uuid references public.tenant_bank_products (id);

alter table public.tenant_bank_products enable row level security;

create policy tenant_bank_products_select on public.tenant_bank_products
for select using (tenant_id = public.jwt_tenant_id());
