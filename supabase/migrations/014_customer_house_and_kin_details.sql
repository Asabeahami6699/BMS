alter table public.customers
  add column if not exists house_number text,
  add column if not exists next_of_kin_name text,
  add column if not exists next_of_kin_phone text,
  add column if not exists next_of_kin_location text,
  add column if not exists next_of_kin_house_number text;
