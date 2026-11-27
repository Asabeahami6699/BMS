-- Support coordinator-unlocked extra collection batches (Batch #2, #3, …) per field agent per business date.
-- Safe for live production: existing rows automatically receive batch_sequence = 1.

alter table public.field_agent_collection_batches
  add column if not exists batch_sequence integer not null default 1 check (batch_sequence >= 1),
  add column if not exists unlocked_by text,
  add column if not exists unlock_reason text,
  add column if not exists unlocked_at timestamptz;

-- Drop the legacy 1-batch-per-day unique constraint on (tenant_id, field_agent_id, business_date),
-- regardless of the auto-generated constraint name.
do $$
declare
  c_name text;
begin
  select con.conname into c_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'field_agent_collection_batches'
    and con.contype = 'u'
    and array_length(con.conkey, 1) = 3;
  if c_name is not null then
    execute format('alter table public.field_agent_collection_batches drop constraint %I', c_name);
  end if;
end $$;

alter table public.field_agent_collection_batches
  drop constraint if exists field_agent_collection_batches_tenant_agent_date_seq_key;

alter table public.field_agent_collection_batches
  add constraint field_agent_collection_batches_tenant_agent_date_seq_key
    unique (tenant_id, field_agent_id, business_date, batch_sequence);

-- Guarantee at most one open (non-posted) batch per field agent per business date.
create unique index if not exists idx_collection_batches_one_open_per_day
  on public.field_agent_collection_batches (tenant_id, field_agent_id, business_date)
  where status in ('draft', 'pending_approval', 'rejected');
