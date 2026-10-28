import { ADDON_DESCRIPTIONS, ADDON_LABELS, type TenantAddon } from "@bms/shared";

type Props = {
  subscribedAddons: TenantAddon[] | undefined;
};

export function SettingsAddonsPage({ subscribedAddons }: Props) {
  const active = subscribedAddons ?? [];

  return (
    <article className="card">
      <h2>Feature Add-Ons</h2>
      <p className="muted">
        Your company cannot enable new add-ons here. Contact platform support to purchase add-ons. You can
        configure only add-ons already active on your subscription.
      </p>
      {active.length === 0 ? (
        <p className="muted">No add-ons are active on your subscription.</p>
      ) : (
        <div className="settings-hub-grid">
          {active.map((addon) => (
            <div className="settings-hub-card settings-hub-card--static" key={addon}>
              <strong>{ADDON_LABELS[addon]}</strong>
              <span className="status-pill status-pill--active">Active</span>
              <p>{ADDON_DESCRIPTIONS[addon]}</p>
              {addon === "sms_notifications" ? (
                <p className="muted">Configure SMS under Settings → Notification Settings.</p>
              ) : (
                <p className="muted">Configuration UI coming soon.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
