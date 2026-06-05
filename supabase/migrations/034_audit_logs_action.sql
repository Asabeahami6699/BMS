alter table public.audit_logs
  add column if not exists action text;

create index if not exists idx_audit_tenant_action on public.audit_logs (tenant_id, created_at desc)
  where action is not null;
