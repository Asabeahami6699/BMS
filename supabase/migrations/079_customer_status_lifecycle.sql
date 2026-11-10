-- Customer account lifecycle: inactive/dormant + last qualifying activity

alter table public.customers
  add column if not exists last_qualifying_activity_at timestamptz;

comment on column public.customers.last_qualifying_activity_at is
  'Last qualifying financial activity (deposit, daily_susu, withdrawal). Used for 12m inactive / 24m dormant rules.';

-- Backfill from customer_transactions where possible
update public.customers c
set last_qualifying_activity_at = sub.last_at
from (
  select
    tenant_id,
    customer_id,
    max(created_at) as last_at
  from public.customer_transactions
  where type in ('daily_susu', 'deposit', 'withdrawal')
    and (reversed_at is null)
  group by tenant_id, customer_id
) sub
where c.tenant_id = sub.tenant_id
  and c.id = sub.customer_id
  and c.last_qualifying_activity_at is null;

-- Fall back to created_at when no transactions
update public.customers
set last_qualifying_activity_at = created_at
where last_qualifying_activity_at is null
  and created_at is not null;

create index if not exists customers_last_activity_status_idx
  on public.customers (tenant_id, status, last_qualifying_activity_at);

-- Keep last_qualifying_activity_at in sync on qualifying posts
create or replace function public.touch_customer_qualifying_activity()
returns trigger
language plpgsql
as $$
begin
  if new.type in ('daily_susu', 'deposit', 'withdrawal')
     and new.reversed_at is null then
    update public.customers
    set last_qualifying_activity_at = coalesce(new.created_at, now())
    where id = new.customer_id
      and tenant_id = new.tenant_id
      and (
        last_qualifying_activity_at is null
        or last_qualifying_activity_at < coalesce(new.created_at, now())
      );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_touch_customer_qualifying_activity on public.customer_transactions;
create trigger trg_touch_customer_qualifying_activity
  after insert on public.customer_transactions
  for each row
  execute function public.touch_customer_qualifying_activity();
