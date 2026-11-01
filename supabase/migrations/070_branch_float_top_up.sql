-- Extra cash asked for on an already open till. Null means no top-up is waiting.

alter table public.branch_float_sessions
  add column if not exists top_up_requested numeric(14, 2),
  add column if not exists top_up_note text;
