do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.investment_products;
    alter publication supabase_realtime add table public.investment_form_configs;
    alter publication supabase_realtime add table public.investments;
    alter publication supabase_realtime add table public.investment_beneficiaries;
    alter publication supabase_realtime add table public.investment_attachments;
    alter publication supabase_realtime add table public.investment_audit_log;
  end if;
exception
  when duplicate_object then null;
end $$;
