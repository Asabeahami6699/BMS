do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'sms_outbox'
  ) then
    alter table public.sms_outbox drop constraint if exists sms_outbox_event_type_check;
    alter table public.sms_outbox
      add constraint sms_outbox_event_type_check
      check (event_type in ('deposit', 'withdrawal', 'daily_susu', 'account_opened', 'test'));
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'email_outbox'
  ) then
    alter table public.email_outbox drop constraint if exists email_outbox_event_type_check;
    alter table public.email_outbox
      add constraint email_outbox_event_type_check
      check (event_type in ('deposit', 'withdrawal', 'daily_susu', 'account_opened', 'test'));
  end if;
end $$;
