-- Public web address for each company: {subdomain}.aabanker.com
-- Existing company ids that are already valid addresses are copied across.

alter table public.tenants
  add column if not exists subdomain text;

create unique index if not exists tenants_subdomain_lower_idx
  on public.tenants (lower(subdomain))
  where subdomain is not null;

update public.tenants
set subdomain = lower(id)
where subdomain is null
  and id <> 'platform'
  and lower(id) ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
  and lower(id) not in (
    'www', 'api', 'admin', 'app', 'mail', 'platform', 'ns1', 'ns2', 'vercel', 'ftp', 'smtp'
  );
