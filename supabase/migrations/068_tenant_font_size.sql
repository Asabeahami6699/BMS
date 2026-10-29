-- Optional larger type for one company. 0 keeps the existing app font.

alter table public.tenants
  add column if not exists font_size_step smallint not null default 0;

alter table public.tenants
  drop constraint if exists tenants_font_size_step_check;

alter table public.tenants
  add constraint tenants_font_size_step_check
  check (font_size_step between 0 and 3);
