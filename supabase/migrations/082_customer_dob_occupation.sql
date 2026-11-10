-- Customer date of birth and occupation (registration / CIF)
alter table public.customers
  add column if not exists date_of_birth date,
  add column if not exists occupation text;

comment on column public.customers.date_of_birth is 'Customer date of birth from registration.';
comment on column public.customers.occupation is 'Customer occupation / livelihood from registration.';
