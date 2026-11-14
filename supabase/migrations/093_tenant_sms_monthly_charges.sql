-- Monthly SMS service charge: admin sets fee (max GHS 5) on notification settings.
-- Active customers are auto-debited once per calendar month.

alter table public.tenant_sms_settings
  add column if not exists sms_charges_enabled boolean not null default false,
  add column if not exists sms_charge_amount_ghs numeric(10, 2) not null default 0;

alter table public.tenant_sms_settings
  drop constraint if exists tenant_sms_settings_sms_charge_amount_check;

alter table public.tenant_sms_settings
  add constraint tenant_sms_settings_sms_charge_amount_check
  check (
    sms_charge_amount_ghs >= 0
    and sms_charge_amount_ghs <= 5
  );

comment on column public.tenant_sms_settings.sms_charges_enabled is
  'When true, active customers are debited sms_charge_amount_ghs once each calendar month.';

comment on column public.tenant_sms_settings.sms_charge_amount_ghs is
  'Monthly SMS service charge in GHS (maximum 5.00).';
