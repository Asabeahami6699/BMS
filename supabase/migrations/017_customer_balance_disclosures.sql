-- Field agents request customer balance; coordinators approve; agent sees balance for 6 hours.

create table if not exists public.customer_balance_disclosures (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  field_agent_id text not null,
  status text not null check (status in ('pending', 'approved', 'rejected', 'expired')),
  balance_amount numeric(12,2),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  expires_at timestamptz,
  approved_by text,
  request_reason text,
  rejected_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_balance_disclosures_agent
  on public.customer_balance_disclosures (tenant_id, field_agent_id, requested_at desc);

create index if not exists idx_balance_disclosures_pending
  on public.customer_balance_disclosures (tenant_id, status)
  where status = 'pending';

alter table public.agent_notifications
  drop constraint if exists agent_notifications_kind_check;

alter table public.agent_notifications
  add constraint agent_notifications_kind_check
  check (
    kind in (
      'registration_approved',
      'registration_rejected',
      'balance_disclosure_approved',
      'balance_disclosure_rejected'
    )
  );
