import { MODULE_DESCRIPTIONS, MODULE_LABELS, type TenantProductModule } from "@bms/shared";

type Props = {
  module: TenantProductModule;
};

export function ModulePlaceholderCard({ module }: Props) {
  return (
    <article className="card">
      <h2>{MODULE_LABELS[module]}</h2>
      <p className="muted">{MODULE_DESCRIPTIONS[module]}</p>
      <p>
        This product is enabled on your subscription. Detailed screens for {MODULE_LABELS[module]} will be
        added in a future release. Use <strong>Reports &amp; Analysis</strong> for cross-product reporting
        today.
      </p>
    </article>
  );
}
