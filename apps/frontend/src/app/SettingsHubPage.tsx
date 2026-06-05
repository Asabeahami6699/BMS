import { Link } from "react-router-dom";

const SETTINGS_ENTRIES = [
  { to: "settings/profile", label: "Company Profile", description: "Name, logo, contact, address, tax, branding." },
  { to: "settings/branches", label: "Branches", description: "Branch network and codes." },
  {
    to: "settings/account-numbers",
    label: "Account numbers",
    description: "12-digit format: company prefix + auto suffix on approval."
  },
  {
    to: "settings/subscription",
    label: "Product Subscription",
    description: "Subscribed products and feature add-ons (read-only)."
  },
  { to: "settings/users", label: "Users", description: "Staff accounts and assignments." },
  { to: "settings/roles", label: "Roles & Permissions", description: "Roles, duties, and permissions." },
  { to: "settings/approval-workflows", label: "Approval Workflows", description: "Customer and withdrawal approval chains." },
  { to: "settings/notifications", label: "Notification Settings", description: "SMS and email notification preferences." },
  { to: "settings/audit-logs", label: "Audit Logs", description: "Activity trail across the workspace." }
] as const;

export function SettingsHubPage() {
  return (
    <article className="card">
      <h2>Settings</h2>
      <p className="muted">
        Organization settings for your company. Add-on configuration is limited to features already active
        on your subscription.
      </p>
      <div className="settings-hub-grid">
        {SETTINGS_ENTRIES.map((entry) => (
          <Link key={entry.to} to={entry.to} className="settings-hub-card">
            <strong>{entry.label}</strong>
            <p>{entry.description}</p>
          </Link>
        ))}
      </div>
    </article>
  );
}
