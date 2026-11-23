-- Security hardening migration:
-- 1. Add visitor_token_hash to live_chat_threads so public chat threads require a
--    cryptographic visitor token (nullable for backwards compatibility with older threads).
-- 2. Enable Row Level Security (RLS) on every table in public schema that does not yet have
--    RLS enabled. The Express backend connects with service_role (which bypasses RLS),
--    while direct PostgREST access via anon/authenticated keys is locked down by default.

alter table if exists public.live_chat_threads
  add column if not exists visitor_token_hash text;

comment on column public.live_chat_threads.visitor_token_hash is
  'SHA-256 hex digest of the visitor secret token required to read/post messages on this public chat thread.';

do $$
declare
  tbl record;
begin
  for tbl in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
      and not rowsecurity
  loop
    execute format('alter table %I.%I enable row level security;', tbl.schemaname, tbl.tablename);
  end loop;
end $$;
