-- Balance + withdrawal requests (same approval queue).

alter table public.customer_balance_disclosures
  add column if not exists request_type text not null default 'balance'
    check (request_type in ('balance', 'withdrawal')),
  add column if not exists withdrawal_amount numeric(12,2),
  add column if not exists fulfillment_mode text default 'next_day_cash'
    check (
      fulfillment_mode is null
      or fulfillment_mode in ('next_day_cash', 'momo', 'agent_next_day')
    );

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
      'withdrawal_request_rejected'
    )
  );
