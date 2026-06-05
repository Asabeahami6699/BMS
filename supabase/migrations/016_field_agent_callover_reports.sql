-- Field agent call-over / reconciliation reports (document vs app)
create table if not exists field_agent_callover_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  field_agent_id text not null,
  report_date date not null default (current_date),
  lines jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  agent_notes text,
  status text not null default 'submitted' check (status in ('submitted', 'reviewed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_callover_reports_tenant_agent_date
  on field_agent_callover_reports (tenant_id, field_agent_id, report_date desc);
