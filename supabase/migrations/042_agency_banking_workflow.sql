-- Agency banking workflow: CS withdrawal gate → Back Officer bank execution → Teller cash payout.
-- Teller deposits: pending_bank → bank_executed (ledger) → completed.

alter table public.customer_balance_disclosures
  drop constraint if exists customer_balance_disclosures_status_check;

alter table public.customer_balance_disclosures
  add constraint customer_balance_disclosures_status_check
  check (
    status in (
      'pending',
      'cs_approved',
      'bank_executed',
      'completed',
      'approved',
      'rejected',
      'expired'
    )
  );

alter table public.customer_balance_disclosures
  add column if not exists cs_approved_by text,
  add column if not exists cs_approved_at timestamptz,
  add column if not exists bank_executed_by text,
  add column if not exists bank_executed_at timestamptz,
  add column if not exists teller_paid_by text,
  add column if not exists teller_paid_at timestamptz,
  add column if not exists linked_transaction_id uuid references public.customer_transactions(id);

alter table public.customer_transactions
  add column if not exists execution_status text not null default 'completed'
    check (execution_status in ('pending_bank', 'bank_executed', 'completed', 'failed')),
  add column if not exists bank_executed_by_user_id text,
  add column if not exists bank_executed_at timestamptz;

create index if not exists idx_transactions_pending_bank
  on public.customer_transactions (tenant_id, execution_status)
  where execution_status = 'pending_bank';

create index if not exists idx_disclosures_cs_approved
  on public.customer_balance_disclosures (tenant_id, status)
  where status = 'cs_approved';

create index if not exists idx_disclosures_bank_executed
  on public.customer_balance_disclosures (tenant_id, status)
  where status = 'bank_executed';

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
      'float_requested',
      'float_allocated',
      'float_closed_pending_settlement',
      'workspace_activity',
      'collection_batch_pending',
      'collection_batch_posted'
    )
  );
