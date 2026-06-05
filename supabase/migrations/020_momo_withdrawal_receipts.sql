-- MoMo withdrawal details, payout receipts, and alert images.

alter table public.customer_balance_disclosures
  add column if not exists momo_number text,
  add column if not exists momo_account_name text,
  add column if not exists payout_reference text,
  add column if not exists transaction_proof_image text,
  add column if not exists generated_receipt_image text,
  add column if not exists paid_at timestamptz;

alter table public.agent_notifications
  add column if not exists image_url text;

alter table public.agent_notifications
  drop constraint if exists agent_notifications_kind_check;

alter table public.agent_notifications
  add constraint agent_notifications_kind_check
  check (
    kind in (
      'registration_approved',
      'registration_rejected',
      'balance_disclosure_approved',
      'balance_disclosure_rejected',
      'withdrawal_request_approved',
      'withdrawal_request_rejected',
      'withdrawal_momo_sent'
    )
  );
