-- Tenant SMS settings (Arkesel transactional alerts) and delivery outbox

create table if not exists public.tenant_sms_settings (
  tenant_id text primary key references public.tenants (id) on delete cascade,
  enabled boolean not null default true,
  notify_deposit boolean not null default true,
  notify_withdrawal boolean not null default true,
  notify_daily_susu boolean not null default true,
  sender_id text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.sms_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  event_type text not null check (event_type in ('deposit', 'withdrawal', 'daily_susu', 'test')),
  phone text not null,
  message_body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  provider_message_id text,
  idempotency_key text not null,
  transaction_id text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (tenant_id, idempotency_key)
);

create index if not exists sms_outbox_tenant_created_idx
  on public.sms_outbox (tenant_id, created_at desc);

alter table public.tenant_sms_settings enable row level security;
alter table public.sms_outbox enable row level security;

create policy tenant_sms_settings_select on public.tenant_sms_settings
for select using (tenant_id = public.jwt_tenant_id());

create policy tenant_sms_settings_upsert on public.tenant_sms_settings
for all using (
  tenant_id = public.jwt_tenant_id()
  and public.jwt_scope_type() = 'head_office'
)
with check (
  tenant_id = public.jwt_tenant_id()
  and public.jwt_scope_type() = 'head_office'
);

create policy sms_outbox_select on public.sms_outbox
for select using (tenant_id = public.jwt_tenant_id());
