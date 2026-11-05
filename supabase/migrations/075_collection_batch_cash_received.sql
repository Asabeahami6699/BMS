-- Coordinator records physical cash brought by mobilizer at callover post time.

alter table public.field_agent_collection_batches
  add column if not exists cash_received_amount numeric(12,2),
  add column if not exists cash_variance numeric(12,2),
  add column if not exists cash_variance_status text
    check (cash_variance_status is null or cash_variance_status in ('balanced', 'shortage', 'overage')),
  add column if not exists cash_received_at timestamptz,
  add column if not exists cash_received_by text;

-- Cascade deletes so trial customers can be removed cleanly.
do $$
declare
  rec record;
begin
  for rec in
    select con.conname, rel.relname as table_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and con.contype = 'f'
      and confrelid = 'public.customers'::regclass
      and rel.relname in (
        'customer_transactions',
        'ledger_entries',
        'field_agent_collection_batch_lines'
      )
  loop
    execute format('alter table public.%I drop constraint if exists %I', rec.table_name, rec.conname);
  end loop;
end $$;

alter table public.customer_transactions
  add constraint customer_transactions_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete cascade;

alter table public.ledger_entries
  add constraint ledger_entries_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete cascade;

alter table public.field_agent_collection_batch_lines
  add constraint field_agent_collection_batch_lines_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete cascade;
