-- Admin-initiated transaction PIN reset: teller may set a new PIN only while this flag is true.
alter table public.users
  add column if not exists transaction_pin_reset_required boolean not null default false;
