-- Back office: company bank accounts, day opening, ecash, execution account tracking.

alter table public.tenant_bank_products
  add column if not exists is_company_bank_account boolean not null default false,
  add column if not exists execution_limit_amount numeric(14, 2);

comment on column public.tenant_bank_products.is_company_bank_account is
  'When true, this product is a company account the back officer uses at the partner bank.';
comment on column public.tenant_bank_products.execution_limit_amount is
  'Deposits above this amount require accountant approval before back-office execution.';

alter table public.customer_transactions
  drop constraint if exists customer_transactions_execution_status_check;

alter table public.customer_transactions
  add constraint customer_transactions_execution_status_check
  check (
    execution_status in (
      'pending_bank',
      'pending_accountant',
      'bank_executed',
      'completed',
      'failed'
    )
  );

alter table public.customer_transactions
  add column if not exists execution_bank_product_id uuid references public.tenant_bank_products (id),
  add column if not exists accountant_approved_by text,
  add column if not exists accountant_approved_at timestamptz;

create index if not exists idx_transactions_pending_accountant
  on public.customer_transactions (tenant_id, execution_status)
  where execution_status = 'pending_accountant';

create table if not exists public.back_office_day_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  branch_id uuid not null references public.branches (id) on delete restrict,
  business_date date not null,
  opened_by_user_id text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  unique (tenant_id, branch_id, business_date)
);

create table if not exists public.back_office_account_opening (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.back_office_day_sessions (id) on delete cascade,
  bank_product_id uuid not null references public.tenant_bank_products (id) on delete restrict,
  opening_balance numeric(14, 2) not null default 0 check (opening_balance >= 0),
  extra_cash numeric(14, 2) not null default 0 check (extra_cash >= 0),
  manual_total_entries numeric(14, 2),
  notes text,
  unique (session_id, bank_product_id)
);

create table if not exists public.back_office_ecash_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  branch_id uuid not null references public.branches (id) on delete restrict,
  session_id uuid references public.back_office_day_sessions (id) on delete set null,
  bank_product_id uuid references public.tenant_bank_products (id) on delete set null,
  requested_by_user_id text not null,
  amount numeric(14, 2) not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  notes text,
  reviewed_by_user_id text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists back_office_ecash_pending_idx
  on public.back_office_ecash_requests (tenant_id, status)
  where status = 'pending';

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
      'withdrawal_cs_approved',
      'withdrawal_ready_for_teller',
      'deposit_pending_bank',
      'deposit_pending_accountant',
      'deposit_completed',
      'back_office_ecash_requested',
      'back_office_ecash_approved',
      'float_requested',
      'float_allocated',
      'float_closed_pending_settlement',
      'workspace_activity',
      'collection_batch_pending',
      'collection_batch_posted'
    )
  );
