-- Remove WhatsApp notifications add-on

delete from public.tenant_addons where addon_key = 'whatsapp_notifications';

alter table public.tenant_addons
  drop constraint if exists tenant_addons_addon_key_check;

alter table public.tenant_addons
  add constraint tenant_addons_addon_key_check check (
    addon_key in (
      'mobile_money',
      'sms_notifications',
      'email_notifications',
      'api_access',
      'multi_branch',
      'advanced_analytics',
      'bulk_import',
      'custom_branding'
    )
  );
