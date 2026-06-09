-- Agency banking: per-product workflow fields, captured workflow data, partner bank accounts.

alter table public.tenant_bank_products
  drop constraint if exists tenant_bank_products_direction_check;

alter table public.tenant_bank_products
  add constraint tenant_bank_products_direction_check
  check (direction in ('deposit', 'withdrawal', 'account_opening'));

alter table public.tenant_bank_products
  add column if not exists workflow_fields jsonb not null default '[]'::jsonb;

alter table public.customer_balance_disclosures
  add column if not exists workflow_data jsonb not null default '{}'::jsonb;

alter table public.customer_transactions
  add column if not exists workflow_data jsonb not null default '{}'::jsonb;

create table if not exists public.customer_partner_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  customer_id text not null,
  bank_product_id uuid references public.tenant_bank_products (id),
  bank_label text not null,
  account_number text not null,
  account_name text not null,
  branch_id text,
  external_reference text,
  workflow_data jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'inactive', 'closed')),
  created_by_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_partner_bank_accounts_uq
  on public.customer_partner_bank_accounts (tenant_id, bank_product_id, account_number)
  where bank_product_id is not null;

create index if not exists customer_partner_bank_accounts_customer_idx
  on public.customer_partner_bank_accounts (tenant_id, customer_id, created_at desc);

alter table public.customer_partner_bank_accounts enable row level security;

create policy customer_partner_bank_accounts_select on public.customer_partner_bank_accounts
for select using (tenant_id = public.jwt_tenant_id());
