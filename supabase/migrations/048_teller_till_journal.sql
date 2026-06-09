create table if not exists teller_till_journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  branch_id uuid not null references branches(id) on delete restrict,
  teller_user_id text not null,
  business_date date not null,
  entry_type text not null check (
    entry_type in ('cash_to_bank', 'expense', 'opening_drawer', 'extra_cash', 'till_count', 'other')
  ),
  amount numeric(14, 2) not null check (amount > 0),
  notes text,
  created_by_user_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists teller_till_journal_tenant_branch_date_idx
  on teller_till_journal_entries (tenant_id, branch_id, business_date desc);

create index if not exists teller_till_journal_teller_date_idx
  on teller_till_journal_entries (tenant_id, teller_user_id, business_date desc);
