-- Susu teller till: separate float capacity from physical cash, track expenses for EOD balance.

alter table public.branch_float_sessions
  add column if not exists initial_cash numeric(14, 2) not null default 0,
  add column if not exists extra_cash numeric(14, 2) not null default 0,
  add column if not exists total_expenses numeric(14, 2) not null default 0;

comment on column public.branch_float_sessions.initial_cash is
  'Physical cash handed to teller at till open (may be 0). Not assumed from opening_float.';
comment on column public.branch_float_sessions.extra_cash is
  'Extra physical cash collected during the day for payouts; adds to day capital.';
comment on column public.branch_float_sessions.total_expenses is
  'Till expenses / petty cash paid from drawer; deducted from expected cash at EOD.';

-- Carry forward open/closed tills from the old model (float was treated as cash).
update public.branch_float_sessions
set initial_cash = opening_float
where coalesce(initial_cash, 0) = 0
  and coalesce(extra_cash, 0) = 0
  and coalesce(total_expenses, 0) = 0
  and opening_float > 0
  and status in ('open', 'closed', 'settled');

alter table public.branch_float_movements
  drop constraint if exists branch_float_movements_movement_type_check;

alter table public.branch_float_movements
  add constraint branch_float_movements_movement_type_check
  check (
    movement_type in (
      'allocation',
      'deposit',
      'withdrawal',
      'adjustment',
      'settlement',
      'extra_cash',
      'expense'
    )
  );
