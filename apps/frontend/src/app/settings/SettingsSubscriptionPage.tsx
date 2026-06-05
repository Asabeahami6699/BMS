import { ADDON_DESCRIPTIONS, ADDON_LABELS, MODULE_LABELS, type TenantAddon, type TenantProductModule } from "@bms/shared";

type Props = {
  subscribedModules: TenantProductModule[] | undefined;
  subscribedAddons: TenantAddon[] | undefined;
  reportsAnalytics?: boolean;
};

export function SettingsSubscriptionPage({
  subscribedModules,
  subscribedAddons,
  reportsAnalytics
}: Props) {
  const products = subscribedModules ?? [];
  const activeAddons = subscribedAddons ?? [];

  return (
    <div className="settings-subscription-stack">
      <article className="card" id="subscription-products">
        <h2>Product subscription</h2>
        <p className="muted">
          Read-only view of products on your plan. Only the platform super admin can change your subscription.
        </p>
        <h3 className="settings-section-title">Subscribed products</h3>
        <div className="module-pills">
          {products.map((m) => (
            <span className="module-pill" key={m}>
              {MODULE_LABELS[m]}
            </span>
          ))}
          {reportsAnalytics !== false && (
            <span className="module-pill module-pill--universal">Reports &amp; Analytics</span>
          )}
        </div>
        {products.length === 0 ? <p className="muted">No product modules assigned.</p> : null}
      </article>

      <article className="card" id="subscription-addons">
        <h3 className="settings-section-title">Feature add-ons</h3>
        <p className="muted">
          Your company cannot enable new add-ons here. Contact platform support to purchase add-ons. You can
          configure only add-ons already active on your subscription.
        </p>
        {activeAddons.length === 0 ? (
          <p className="muted">No add-ons are active on your subscription.</p>
        ) : (
          <div className="settings-hub-grid">
            {activeAddons.map((addon) => (
              <div className="settings-hub-card settings-hub-card--static" key={addon}>
                <strong>{ADDON_LABELS[addon]}</strong>
                <span className="status-pill status-pill--active">Active</span>
                <p>{ADDON_DESCRIPTIONS[addon]}</p>
                <p className="muted">Configuration UI coming soon.</p>
              </div>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}
