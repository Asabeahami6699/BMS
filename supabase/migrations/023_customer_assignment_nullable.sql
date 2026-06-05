-- Allow coordinators to unassign customers from field agents (assign later from Agents screen).
alter table public.customers
  alter column assigned_field_agent_id drop not null;
