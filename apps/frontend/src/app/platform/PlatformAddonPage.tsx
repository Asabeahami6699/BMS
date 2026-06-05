import { ADDON_DESCRIPTIONS, ADDON_LABELS, type TenantAddon } from "@bms/shared";
import { FeaturePlaceholderPage } from "../FeaturePlaceholderPage";

const ADDON_ROUTE_MAP: Record<string, TenantAddon> = {
  "mobile-money": "mobile_money",
  sms: "sms_notifications",
  email: "email_notifications",
  api: "api_access",
  "multi-branch": "multi_branch",
  analytics: "advanced_analytics",
  "bulk-import": "bulk_import",
  branding: "custom_branding"
};

type Props = {
  slug: string;
};

export function PlatformAddonPage({ slug }: Props) {
  const addon = ADDON_ROUTE_MAP[slug];
  if (!addon) {
    return <FeaturePlaceholderPage title="Add-on" description="Unknown add-on." />;
  }

  return (
    <FeaturePlaceholderPage
      title={ADDON_LABELS[addon]}
      description={`${ADDON_DESCRIPTIONS[addon]} Assign this add-on to a company from the Companies page when registering or editing a tenant.`}
    />
  );
}
