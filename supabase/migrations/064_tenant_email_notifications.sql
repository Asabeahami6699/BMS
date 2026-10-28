-- Tenant email notification settings and delivery outbox

create table if not exists public.tenant_email_settings (
  tenant_id text primary key references public.tenants (id) on delete cascade,
  enabled boolean not null default true,
  notify_deposit boolean not null default true,
  notify_withdrawal boolean not null default true,
  notify_daily_susu boolean not null default true,
  from_name text,
  reply_to_email text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  event_type text not null check (event_type in ('deposit', 'withdrawal', 'daily_susu', 'test')),
  to_email text not null,
  subject text not null,
  message_body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'logged')),
  idempotency_key text not null,
  transaction_id text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (tenant_id, idempotency_key)
);

create index if not exists email_outbox_tenant_created_idx
  on public.email_outbox (tenant_id, created_at desc);

alter table public.tenant_email_settings enable row level security;
alter table public.email_outbox enable row level security;

create policy tenant_email_settings_select on public.tenant_email_settings
for select using (tenant_id = public.jwt_tenant_id());

create policy tenant_email_settings_upsert on public.tenant_email_settings
for all using (
  tenant_id = public.jwt_tenant_id()
  and public.jwt_scope_type() = 'head_office'
)
with check (
  tenant_id = public.jwt_tenant_id()
  and public.jwt_scope_type() = 'head_office'
);

create policy email_outbox_select on public.email_outbox
for select using (tenant_id = public.jwt_tenant_id());
