import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { hasTenantAddon, type TenantAddon } from "@bms/shared";
import { sendTenantTestSms, type MessageLogItem, type TenantSmsSettings } from "../api";
import { useToast } from "../../components/Toast";
import { useSettingsWorkspaceStore } from "../stores/settingsWorkspaceStore";

type Props = {
  subscribedAddons: TenantAddon[] | undefined;
};

const EVENT_LABELS: Record<string, string> = {
  deposit: "Deposit credited",
  withdrawal: "Withdrawal debited",
  daily_susu: "Daily susu",
  account_opened: "Account opened",
  test: "Test"
};

function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType;
}

function statusLabel(status: MessageLogItem["status"]): string {
  if (status === "sent") {
    return "Sent";
  }
  if (status === "failed") {
    return "Failed";
  }
  if (status === "logged") {
    return "Not delivered";
  }
  return "Waiting";
}

function statusClass(status: MessageLogItem["status"]): string {
  if (status === "sent") {
    return "status-pill status-pill--active";
  }
  if (status === "failed") {
    return "status-pill status-pill--failed";
  }
  return "status-pill status-pill--pending";
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function SettingsNotificationsPage({ subscribedAddons }: Props) {
  const hasSms = hasTenantAddon(subscribedAddons, "sms_notifications");
  const hasEmail = hasTenantAddon(subscribedAddons, "email_notifications");
  const { showToast } = useToast();
  const [testing, setTesting] = useState(false);
  const [testPhone, setTestPhone] = useState("");

  const {
    loading,
    saving,
    lastFetchedAt,
    error,
    smsReady,
    settings,
    logLoading,
    logItems,
    logReady,
    hydrateSection,
    startLiveSync,
    stopLiveSync,
    setNotificationsChannels,
    setSmsSettings,
    saveSmsSettings,
    refreshMessageLog
  } = useSettingsWorkspaceStore(
    useShallow((s) => ({
      loading: s.section.notifications.loading,
      saving: s.savingNotifications,
      lastFetchedAt: s.section.notifications.lastFetchedAt,
      error: s.section.notifications.error,
      smsReady: s.smsReady,
      settings: s.smsSettings,
      logLoading: s.messageLogLoading,
      logItems: s.messageLogItems,
      logReady: s.messageLogReady,
      hydrateSection: s.hydrateSection,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync,
      setNotificationsChannels: s.setNotificationsChannels,
      setSmsSettings: s.setSmsSettings,
      saveSmsSettings: s.saveSmsSettings,
      refreshMessageLog: s.refreshMessageLog
    }))
  );

  useEffect(() => {
    setNotificationsChannels({ hasSms, hasEmail });
    if (hasSms || hasEmail) {
      hydrateSection("notifications");
      startLiveSync("notifications");
    }
    return () => stopLiveSync();
  }, [hasEmail, hasSms, hydrateSection, setNotificationsChannels, startLiveSync, stopLiveSync]);

  useEffect(() => {
    if (error) {
      showToast(error, "error");
    }
  }, [error, showToast]);

  function updateSettings(patch: Partial<TenantSmsSettings>) {
    if (!settings) {
      return;
    }
    setSmsSettings({ ...settings, ...patch });
  }

  async function handleSave() {
    if (!settings) {
      return;
    }
    try {
      const updated = await saveSmsSettings({
        enabled: settings.enabled,
        notifyDeposit: settings.notifyDeposit,
        notifyWithdrawal: settings.notifyWithdrawal,
        notifyDailySusu: settings.notifyDailySusu,
        senderId: settings.senderId?.trim() || undefined
      });
      setSmsSettings(updated);
      showToast("SMS settings saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save SMS settings", "error");
    }
  }

  async function handleTestSms() {
    if (!testPhone.trim()) {
      showToast("Enter a mobile number for the test SMS", "error");
      return;
    }
    setTesting(true);
    try {
      const result = await sendTenantTestSms({ phone: testPhone.trim() });
      showToast(`Test SMS sent to ${result.phone}`, "success");
      await refreshMessageLog();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Test SMS failed", "error");
    } finally {
      setTesting(false);
    }
  }

  const smsLoading = hasSms && loading && lastFetchedAt == null;

  return (
    <article className="card">
      <h2>Notification Settings</h2>
      <p className="muted">Configure notification channels enabled on your subscription.</p>

      <div className="settings-hub-grid">
        <div className={`settings-hub-card ${hasSms ? "" : "settings-hub-card--static"}`}>
          <strong>SMS Notifications (Arkesel)</strong>
          <span className={`status-pill status-pill--${hasSms ? "active" : "inactive"}`}>
            {hasSms ? "Active add-on" : "Not on subscription"}
          </span>

          {!hasSms ? (
            <p>Contact platform support to add SMS notifications to your subscription.</p>
          ) : smsLoading ? (
            <p className="muted">Loading SMS settings…</p>
          ) : settings ? (
            <>
              {smsReady === false ? (
                <p className="muted">
                  Arkesel is not configured on the server yet. Ask your platform administrator to add the Arkesel API
                  key.
                </p>
              ) : (
                <p className="muted">
                  Customers receive SMS when deposits, withdrawals, or daily susu collections are posted to their
                  account.
                </p>
              )}

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => updateSettings({ enabled: e.target.checked })}
                />
                <span>Enable customer SMS alerts</span>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.notifyDeposit}
                  disabled={!settings.enabled}
                  onChange={(e) => updateSettings({ notifyDeposit: e.target.checked })}
                />
                <span>Deposit credited</span>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.notifyWithdrawal}
                  disabled={!settings.enabled}
                  onChange={(e) => updateSettings({ notifyWithdrawal: e.target.checked })}
                />
                <span>Withdrawal debited</span>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.notifyDailySusu}
                  disabled={!settings.enabled}
                  onChange={(e) => updateSettings({ notifyDailySusu: e.target.checked })}
                />
                <span>Daily susu collection posted</span>
              </label>

              <label>
                <span>Sender ID</span>
                <input
                  type="text"
                  maxLength={11}
                  placeholder="Evans Susu"
                  value={settings.senderId ?? ""}
                  onChange={(e) => updateSettings({ senderId: e.target.value })}
                />
                <p className="muted">
                  Must match an Arkesel-approved sender ID (max 11 characters). New names are not deliverable until
                  Arkesel approves them — they usually ask for your business registration certificate and an
                  authorization letter on company letterhead. Register the ID in your Arkesel dashboard and wait for
                  approval before enabling live customer SMS.
                </p>
              </label>

              <div className="form-actions">
                <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void handleSave()}>
                  {saving ? "Saving…" : "Save SMS settings"}
                </button>
              </div>

              <hr />

              <label>
                <span>Send test SMS</span>
                <input
                  type="tel"
                  placeholder="0244123456"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={testing || smsReady === false}
                  onClick={() => void handleTestSms()}
                >
                  {testing ? "Sending…" : "Send test"}
                </button>
              </div>
            </>
          ) : null}
        </div>

        <div className="settings-hub-card settings-hub-card--static">
          <strong>Email Notifications</strong>
          <span className={`status-pill status-pill--${hasEmail ? "active" : "inactive"}`}>
            {hasEmail ? "Active add-on" : "Not on subscription"}
          </span>
          <p>{hasEmail ? "Email channel configuration coming soon." : "Contact platform support to add email notifications."}</p>
        </div>
      </div>

      {hasSms || hasEmail ? (
        <section className="message-log">
          <div className="message-log__head">
            <div>
              <h3>Message log</h3>
              <p className="muted">
                Recent customer SMS and email. Sent means the provider accepted the message. It does not confirm the
                phone received it. Failed shows why it did not go out.
              </p>
            </div>
            <button
              type="button"
              className="button secondary"
              disabled={logLoading}
              onClick={() => void refreshMessageLog()}
            >
              {logLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {logLoading && logItems.length === 0 ? (
            <p className="muted">Loading message log…</p>
          ) : !logReady ? (
            <p className="muted">
              Message history is not ready yet. Apply the SMS and email outbox migrations in Supabase, then refresh.
            </p>
          ) : logItems.length === 0 ? (
            <p className="muted">No customer messages have been recorded yet.</p>
          ) : (
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Channel</th>
                    <th>Event</th>
                    <th>Customer</th>
                    <th>Sent to</th>
                    <th>Status</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {logItems.map((item) => (
                    <tr key={item.id}>
                      <td>{formatWhen(item.createdAt)}</td>
                      <td>{item.channel === "sms" ? "SMS" : "Email"}</td>
                      <td>{eventLabel(item.eventType)}</td>
                      <td>{item.customerName || "—"}</td>
                      <td>{item.recipient}</td>
                      <td>
                        <span className={statusClass(item.status)}>{statusLabel(item.status)}</span>
                        {item.errorMessage ? <p className="message-log__error">{item.errorMessage}</p> : null}
                      </td>
                      <td className="message-log__preview">{item.preview || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </article>
  );
}
