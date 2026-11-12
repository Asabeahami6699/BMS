import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  approvePlatformBillingClaim,
  assignPlatformTenantPlan,
  getPlatformBillingSettings,
  listPlatformBillingPlans,
  listPlatformPendingBillingClaims,
  rejectPlatformBillingClaim,
  updatePlatformBillingSettings,
  type PlatformBillingSettingsDto,
  type SubscriptionPaymentClaimDto,
  type SubscriptionPlanDto
} from "../api";
import { useToast } from "../../components/Toast";
import { usePlatformAdminStore } from "../stores/platformAdminStore";
import { toUserFacingError } from "../../lib/networkError";

function formatMoney(amount: number): string {
  return `GHS ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function SubscriptionManagementPage() {
  const { showToast } = useToast();
  const { tenants, statusMessage, loading, lastFetchedAt, hydrate, refresh } = usePlatformAdminStore(
    useShallow((s) => ({
      tenants: s.tenants,
      statusMessage: s.statusMessage,
      loading: s.loading,
      lastFetchedAt: s.lastFetchedAt,
      hydrate: s.hydrate,
      refresh: s.refresh
    }))
  );

  const [settings, setSettings] = useState<PlatformBillingSettingsDto | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlanDto[]>([]);
  const [claims, setClaims] = useState<SubscriptionPaymentClaimDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [assignTenantId, setAssignTenantId] = useState("");
  const [assignPlanId, setAssignPlanId] = useState("");

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    void (async () => {
      try {
        const [billingSettings, billingPlans, pending] = await Promise.all([
          getPlatformBillingSettings(),
          listPlatformBillingPlans(),
          listPlatformPendingBillingClaims()
        ]);
        setSettings(billingSettings);
        setPlans(billingPlans);
        setClaims(pending);
        if (!assignPlanId && billingPlans[0]?.id) {
          setAssignPlanId(billingPlans[0].id);
        }
      } catch (error) {
        showToast(toUserFacingError(error, "Failed to load billing"), "error");
      }
    })();
  }, [assignPlanId, showToast]);

  const active = tenants.filter((t) => t.subscriptionStatus === "active").length;
  const grace = tenants.filter((t) => t.billingStatus === "grace" || t.billingStatus === "due_soon").length;
  const showStatus = statusMessage && loading && lastFetchedAt == null;

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) {
      return;
    }
    setBusy(true);
    try {
      const next = await updatePlatformBillingSettings(settings);
      setSettings(next);
      showToast("MoMo billing settings saved", "success");
    } catch (error) {
      showToast(toUserFacingError(error, "Save failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function approveClaim(claimId: string) {
    setBusy(true);
    try {
      await approvePlatformBillingClaim(claimId);
      setClaims((prev) => prev.filter((c) => c.id !== claimId));
      await refresh();
      showToast("Payment approved — company subscription activated", "success");
    } catch (error) {
      showToast(toUserFacingError(error, "Approve failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function rejectClaim(claimId: string) {
    const reason = window.prompt("Rejection reason");
    if (!reason?.trim()) {
      return;
    }
    setBusy(true);
    try {
      await rejectPlatformBillingClaim(claimId, reason.trim());
      setClaims((prev) => prev.filter((c) => c.id !== claimId));
      showToast("Payment claim rejected", "success");
    } catch (error) {
      showToast(toUserFacingError(error, "Reject failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function assignPlan(e: React.FormEvent) {
    e.preventDefault();
    if (!assignTenantId || !assignPlanId) {
      showToast("Select company and plan", "error");
      return;
    }
    setBusy(true);
    try {
      await assignPlatformTenantPlan(assignTenantId, { planId: assignPlanId, activate: true });
      await refresh();
      showToast("Plan assigned and period started", "success");
    } catch (error) {
      showToast(toUserFacingError(error, "Assign failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="subscription-platform-workspace workspace-animate-in">
      <header className="role-workspace__hero role-workspace--violet">
        <div className="role-workspace__hero-head">
          <div>
            <p className="eyebrow">Platform</p>
            <h2>Subscription management</h2>
            <p className="muted">
              MoMo pay-to number, pending payment approvals, plans, and company renewal periods.
            </p>
          </div>
        </div>
      </header>

      <section className="kpi-grid">
        <article className="kpi-card kpi-card--primary">
          <p className="kpi-label">Companies</p>
          <p className="kpi-value">{tenants.length}</p>
        </article>
        <article className="kpi-card kpi-card--success">
          <p className="kpi-label">Active</p>
          <p className="kpi-value">{active}</p>
        </article>
        <article className="kpi-card kpi-card--warning">
          <p className="kpi-label">Due / grace</p>
          <p className="kpi-value">{grace}</p>
        </article>
        <article className="kpi-card kpi-card--purple">
          <p className="kpi-label">Pending MoMo claims</p>
          <p className="kpi-value">{claims.length}</p>
        </article>
      </section>

      <div className="settings-subscription-grid">
        <article className="card">
          <h2>Your MoMo pay-to details</h2>
          <p className="muted">Companies send subscription fees to this number. You approve claims after payment.</p>
          {settings ? (
            <form onSubmit={(e) => void saveSettings(e)}>
              <label className="field">
                <span>MoMo number</span>
                <input
                  value={settings.momoNumber}
                  onChange={(e) => setSettings({ ...settings, momoNumber: e.target.value })}
                  placeholder="0244…"
                  required
                />
              </label>
              <label className="field">
                <span>Account name</span>
                <input
                  value={settings.momoAccountName}
                  onChange={(e) => setSettings({ ...settings, momoAccountName: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span>Network</span>
                <input
                  value={settings.momoNetwork}
                  onChange={(e) => setSettings({ ...settings, momoNetwork: e.target.value })}
                />
              </label>
              <div className="subscription-claim-actions">
                <button type="submit" className="button primary" disabled={busy}>
                  Save MoMo settings
                </button>
              </div>
            </form>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </article>

        <article className="card">
          <h2>Assign / renew plan</h2>
          <p className="muted">Start a billing period for a company (manual activation without a claim).</p>
          <form onSubmit={(e) => void assignPlan(e)}>
            <label className="field">
              <span>Company</span>
              <select value={assignTenantId} onChange={(e) => setAssignTenantId(e.target.value)} required>
                <option value="">Select company</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Plan</span>
              <select value={assignPlanId} onChange={(e) => setAssignPlanId(e.target.value)} required>
                {plans
                  .filter((plan) => plan.isActive)
                  .map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} — {formatMoney(plan.priceGhs)}/mo · setup {formatMoney(plan.setupFeeGhs ?? 0)}
                    </option>
                  ))}
              </select>
            </label>
            <div className="subscription-claim-actions">
              <button type="submit" className="button primary" disabled={busy}>
                Assign &amp; activate
              </button>
            </div>
          </form>
        </article>
      </div>

      <article className="card">
        <h2>Pending MoMo payment claims</h2>
        <p className="muted">Approve after you confirm the MoMo credit on your phone.</p>
        {!claims.length ? (
          <p className="muted">No pending claims.</p>
        ) : (
          <div className="lines">
            {claims.map((claim) => (
              <div className="line tenant-line" key={claim.id}>
                <div>
                  <strong>
                    {claim.tenantName ?? claim.tenantId} · {formatMoney(claim.amountGhs)}
                  </strong>
                  <small>
                    {claim.planName ?? claim.planId} · Ref {claim.momoReference} · {claim.payerName} (
                    {claim.payerNumber})
                  </small>
                  {claim.notes ? <p className="muted">{claim.notes}</p> : null}
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy}
                    onClick={() => void approveClaim(claim.id)}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void rejectClaim(claim.id)}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>

      <article className="card">
        <h2>Companies &amp; periods</h2>
        {showStatus ? <p className="muted">{statusMessage}</p> : null}
        <div className="lines">
          {tenants.map((tenant) => (
            <div className="line tenant-line" key={tenant.id}>
              <div>
                <strong>{tenant.name}</strong>
                <small>
                  {tenant.id} · system {tenant.subscriptionStatus}
                  {tenant.billingStatus ? ` · billing ${tenant.billingStatus}` : ""}
                  {tenant.periodStart ? ` · ${tenant.periodStart} → ${tenant.periodEnd ?? "—"}` : ""}
                </small>
                <p className="muted">
                  Products: {(tenant.subscribedModules ?? []).join(", ") || "none"}
                  {(tenant.subscribedAddons ?? []).length > 0
                    ? ` · Add-ons: ${tenant.subscribedAddons!.join(", ")}`
                    : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="card">
        <h2>Package catalog</h2>
        <p className="muted">
          Monthly package fees are enrollment charges. SMS is usage-based (Arkesel) and separate from the
          package price. First enrollment also collects the setup fee.
        </p>
        <div className="subscription-plan-picker">
          {plans.map((plan) => (
            <div className="subscription-plan-option" key={plan.id}>
              <span className="subscription-plan-tier">
                {(plan.packageTier ?? "package").replace(/_/g, " ")}
              </span>
              <strong>{plan.name}</strong>
              <span className="subscription-plan-price">
                {plan.isCustom ? "from " : ""}
                {formatMoney(plan.priceGhs)} / {plan.interval}
              </span>
              <span className="subscription-plan-setup">
                Setup fee: {plan.isCustom ? "from " : ""}
                {formatMoney(plan.setupFeeGhs ?? 0)}
              </span>
              <ul className="subscription-plan-bullets">
                {(plan.featureBullets ?? []).map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
              <small className="muted">
                Modules: {(plan.modules ?? []).join(", ") || "none"}
                {(plan.addons ?? []).length ? ` · Add-ons: ${plan.addons.join(", ")}` : ""}
              </small>
              <span className={`status-pill status-pill--${plan.isActive ? "active" : "inactive"}`}>
                {plan.isActive ? "active" : "inactive"}
              </span>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}
