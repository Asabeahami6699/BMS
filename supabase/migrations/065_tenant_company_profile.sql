-- Company profile fields edited by the tenant admin under Settings → Company Profile.

alter table public.tenants
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists tax_id text,
  add column if not exists logo_url text,
  add column if not exists brand_color text;
