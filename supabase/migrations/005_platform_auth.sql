create table if not exists public.tenants (
  id text primary key,
  name text not null,
  subscription_status text not null default 'active'
    check (subscription_status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

alter table public.users
  add column if not exists email text,
  add column if not exists full_name text,
  add column if not exists auth_user_id uuid unique,
  add column if not exists created_by text;

create index if not exists users_email_idx on public.users (lower(email));
