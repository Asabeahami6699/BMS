-- Extended customer registration fields and agent notifications.

alter table public.customers
  add column if not exists email text,
  add column if not exists location text,
  add column if not exists account_type text,
  add column if not exists id_card_number text,
  add column if not exists photo_url text,
  add column if not exists next_of_kin text,
  add column if not exists account_number text,
  add column if not exists rejection_reason text;

create unique index if not exists idx_customers_account_number
  on public.customers (tenant_id, account_number)
  where account_number is not null;

create table if not exists public.agent_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  user_id text not null,
  customer_id uuid references public.customers(id) on delete set null,
  kind text not null check (kind in ('registration_approved', 'registration_rejected')),
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_notifications_user
  on public.agent_notifications (tenant_id, user_id, created_at desc);
