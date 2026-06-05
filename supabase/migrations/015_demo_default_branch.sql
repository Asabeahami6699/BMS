-- Ensure demo tenant has at least one branch for customer registration (home_branch_id FK).
insert into public.branches (tenant_id, code, name, status)
select 'tenant-demo', 'MAIN', 'Main Branch', 'active'
where not exists (
  select 1 from public.branches where tenant_id = 'tenant-demo'
);
