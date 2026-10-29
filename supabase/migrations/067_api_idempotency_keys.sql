create table if not exists public.api_idempotency_keys (
  tenant_id text not null,
  idempotency_key text not null,
  status_code integer not null,
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, idempotency_key)
);

alter table public.api_idempotency_keys enable row level security;
