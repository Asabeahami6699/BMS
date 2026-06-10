-- Teller slot (1–4) for users whose primary job title is teller.
alter table public.users
  add column if not exists teller_type smallint check (teller_type is null or teller_type between 1 and 4);

comment on column public.users.teller_type is 'Teller desk slot (1–4) when role is teller; null for other job titles.';
