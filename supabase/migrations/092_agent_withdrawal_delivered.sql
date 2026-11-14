-- Field agent confirms cash was delivered to the customer after office Pay now.

alter table public.customer_balance_disclosures
  add column if not exists agent_delivered_by text,
  add column if not exists agent_delivered_at timestamptz;

comment on column public.customer_balance_disclosures.agent_delivered_at is
  'When the field agent confirmed cash delivery to the customer (after till Pay now).';

create index if not exists idx_disclosures_awaiting_agent_delivery
  on public.customer_balance_disclosures (tenant_id, field_agent_id, status)
  where request_type = 'withdrawal'
    and status = 'completed'
    and agent_delivered_at is null;

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
      'withdrawal_agent_delivered',
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
      'collection_batch_posted',
      'susu_collection_reversed',
      'cash_shortage_opened',
      'cash_overage_opened',
      'cash_variance_settled',
      'vault_opening_adjusted',
      'vault_close_variance',
      'loan_repayment_reserved',
      'loan_auto_repayment',
      'loan_auto_repayment_failed'
    )
  );
