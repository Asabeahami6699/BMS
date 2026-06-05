-- Enable Supabase Realtime for tables the field agent app subscribes to.
-- In the Supabase dashboard you can also add these under Database → Replication.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.customers;
    alter publication supabase_realtime add table public.customer_balance_disclosures;
    alter publication supabase_realtime add table public.agent_notifications;
    alter publication supabase_realtime add table public.customer_transactions;
  end if;
exception
  when duplicate_object then null;
end $$;
