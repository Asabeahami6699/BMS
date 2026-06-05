-- Workspace notification kinds (bell) for admins, coordinators, and audit activity.

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
      'workspace_activity'
    )
  );
