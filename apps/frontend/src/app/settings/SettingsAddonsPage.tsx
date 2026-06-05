import { ADDON_DESCRIPTIONS, ADDON_LABELS, hasTenantAddon, type TenantAddon } from "@bms/shared";
import { FeaturePlaceholderPage } from "../FeaturePlaceholderPage";

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
              <p className="muted">Configuration UI coming soon.</p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export function SettingsNotificationsPage({ subscribedAddons }: Props) {
  const hasSms = hasTenantAddon(subscribedAddons, "sms_notifications");
  const hasEmail = hasTenantAddon(subscribedAddons, "email_notifications");

  return (
    <article className="card">
      <h2>Notification Settings</h2>
      <p className="muted">Configure notification channels enabled on your subscription.</p>
      <div className="settings-hub-grid">
        <div className="settings-hub-card settings-hub-card--static">
          <strong>SMS Notifications</strong>
          <span className={`status-pill status-pill--${hasSms ? "active" : "inactive"}`}>
            {hasSms ? "Active add-on" : "Not on subscription"}
          </span>
          <p>{hasSms ? "SMS channel configuration coming soon." : "Contact platform support to add SMS notifications."}</p>
        </div>
        <div className="settings-hub-card settings-hub-card--static">
          <strong>Email Notifications</strong>
          <span className={`status-pill status-pill--${hasEmail ? "active" : "inactive"}`}>
            {hasEmail ? "Active add-on" : "Not on subscription"}
          </span>
          <p>{hasEmail ? "Email channel configuration coming soon." : "Contact platform support to add email notifications."}</p>
        </div>
      </div>
    </article>
  );
}
