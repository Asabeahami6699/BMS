import { useEffect, useState } from "react";
import { hasTenantAddon, type TenantAddon } from "@bms/shared";
import {
  getSmsPlatformStatus,
  getTenantSmsSettings,
  sendTenantTestSms,
  updateTenantSmsSettings,
  type TenantSmsSettings
} from "../api";
import { useToast } from "../../components/Toast";

type Props = {
  subscribedAddons: TenantAddon[] | undefined;
};

export function SettingsNotificationsPage({ subscribedAddons }: Props) {
  const hasSms = hasTenantAddon(subscribedAddons, "sms_notifications");
  const hasEmail = hasTenantAddon(subscribedAddons, "email_notifications");
  const { showToast } = useToast();

  const [loading, setLoading] = useState(hasSms);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [smsReady, setSmsReady] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<TenantSmsSettings | null>(null);
  const [testPhone, setTestPhone] = useState("");

  useEffect(() => {
    if (!hasSms) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [platform, smsSettings] = await Promise.all([
          getSmsPlatformStatus(),
          getTenantSmsSettings()
        ]);
        if (!cancelled) {
          setSmsReady(platform.configured);
          setSettings(smsSettings);
        }
      } catch (error) {
        if (!cancelled) {
          showToast(error instanceof Error ? error.message : "Failed to load SMS settings", "error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasSms, showToast]);

  async function handleSave() {
    if (!settings) {
      return;
    }
    setSaving(true);
    try {
      const updated = await updateTenantSmsSettings({
        enabled: settings.enabled,
        notifyDeposit: settings.notifyDeposit,
        notifyWithdrawal: settings.notifyWithdrawal,
        notifyDailySusu: settings.notifyDailySusu,
        senderId: settings.senderId?.trim() || null
      });
      setSettings(updated);
      showToast("SMS settings saved", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save SMS settings", "error");
    } finally {
      setSaving(false);
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
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Test SMS failed", "error");
    } finally {
      setTesting(false);
    }
  }

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
          ) : loading ? (
            <p className="muted">Loading SMS settings…</p>
          ) : settings ? (
            <>
              {smsReady === false ? (
                <p className="muted">
                  Arkesel is not configured on the server yet. Ask your platform administrator to add
                  the Arkesel API key.
                </p>
              ) : (
                <p className="muted">
                  Customers receive SMS when deposits, withdrawals, or daily susu collections are posted to
                  their account.
                </p>
              )}

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                />
                <span>Enable customer SMS alerts</span>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.notifyDeposit}
                  disabled={!settings.enabled}
                  onChange={(e) => setSettings({ ...settings, notifyDeposit: e.target.checked })}
                />
                <span>Deposit credited</span>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.notifyWithdrawal}
                  disabled={!settings.enabled}
                  onChange={(e) => setSettings({ ...settings, notifyWithdrawal: e.target.checked })}
                />
                <span>Withdrawal debited</span>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.notifyDailySusu}
                  disabled={!settings.enabled}
                  onChange={(e) => setSettings({ ...settings, notifyDailySusu: e.target.checked })}
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
                  onChange={(e) => setSettings({ ...settings, senderId: e.target.value })}
                />
                <p className="muted">Use the approved Arkesel name, including the space. Maximum 11 characters.</p>
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
    </article>
  );
}
