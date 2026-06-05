import { MODULE_DESCRIPTIONS, MODULE_LABELS, type TenantProductModule } from "@bms/shared";
import { FeaturePlaceholderPage } from "../FeaturePlaceholderPage";

type Props = {
  product: TenantProductModule | "reports_analytics";
};

const REPORTS_COPY = {
  title: "Reports & Analytics",
  description:
    "Included for every active company. Cross-department reporting scoped to subscribed products and add-ons."
};

export function PlatformProductPage({ product }: Props) {
  if (product === "reports_analytics") {
    return (
      <FeaturePlaceholderPage title={REPORTS_COPY.title} description={REPORTS_COPY.description} />
    );
  }

  return (
    <FeaturePlaceholderPage
      title={MODULE_LABELS[product]}
      description={MODULE_DESCRIPTIONS[product]}
    />
  );
}
