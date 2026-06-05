-- Field agent daily collections: draft → pending approval → posted (coordinator credits accounts).

create table if not exists public.field_agent_collection_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  field_agent_id text not null,
  business_date date not null default (current_date),
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'posted', 'rejected')),
  total_amount numeric(12,2) not null default 0,
  line_count integer not null default 0,
  callover_report_id uuid references public.field_agent_callover_reports(id),
  agent_notes text,
  submitted_at timestamptz,
  posted_at timestamptz,
  posted_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, field_agent_id, business_date)
);

create table if not exists public.field_agent_collection_batch_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.field_agent_collection_batches(id) on delete cascade,
  tenant_id text not null,
  customer_id uuid not null references public.customers(id),
  amount numeric(12,2) not null check (amount > 0),
  notes text,
  client_line_id text,
  transaction_id uuid references public.customer_transactions(id),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_collection_batch_lines_client
  on public.field_agent_collection_batch_lines (batch_id, client_line_id)
  where client_line_id is not null;

create index if not exists idx_collection_batches_tenant_status
  on public.field_agent_collection_batches (tenant_id, business_date desc, status);

create index if not exists idx_collection_batches_agent_date
  on public.field_agent_collection_batches (tenant_id, field_agent_id, business_date desc);

alter table public.field_agent_collection_batches enable row level security;
alter table public.field_agent_collection_batch_lines enable row level security;

create policy field_agent_collection_batches_select on public.field_agent_collection_batches
for select using (tenant_id = public.jwt_tenant_id());

create policy field_agent_collection_batch_lines_select on public.field_agent_collection_batch_lines
for select using (tenant_id = public.jwt_tenant_id());

-- Bell notification kinds for collection batch workflow.
alter table public.agent_notifications
  drop constraint if exists agent_notifications_kind_check;

alter table public.agent_notifications
  add constraint agent_notifications_kind_check
  check (
    kind in (
      'registration_approved',
      'registration_rejected',
      'registration_pending',
      'balance_disclosure_approved',
      'balance_disclosure_rejected',
      'balance_request_pending',
      'withdrawal_request_approved',
      'withdrawal_request_rejected',
      'withdrawal_request_pending',
      'withdrawal_momo_sent',
      'float_requested',
      'float_allocated',
      'float_closed_pending_settlement',
      'workspace_activity',
      'collection_batch_pending',
      'collection_batch_posted'
    )
  );
