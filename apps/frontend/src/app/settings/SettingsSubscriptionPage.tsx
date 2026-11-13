import { useEffect, useMemo, useState } from "react";
import {
  ADDON_LABELS,
  MODULE_LABELS,
  SUBSCRIPTION_PACKAGE_TIER_LABELS,
  TENANT_BILLING_STATUS_LABELS,
  isFreeSubscriptionPlan,
  subscriptionClaimAmountGhs,
  type TenantAddon,
  type TenantProductModule
} from "@bms/shared";
import { useToast } from "../../components/Toast";
import { useSubscriptionBillingStore } from "../stores/subscriptionBillingStore";
import { usePageLoading } from "../hooks/usePageLoading";

type Props = {
  subscribedModules: TenantProductModule[] | undefined;
  subscribedAddons: TenantAddon[] | undefined;
  reportsAnalytics?: boolean;
};

function formatMoney(amount: number): string {
  return `GHS ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function SettingsSubscriptionPage({
  subscribedModules,
  subscribedAddons,
  reportsAnalytics
}: Props) {
  const { showToast } = useToast();
  const snapshot = useSubscriptionBillingStore((s) => s.snapshot);
  const plans = useSubscriptionBillingStore((s) => s.plans);
  const loading = useSubscriptionBillingStore((s) => s.loading);
  const submitting = useSubscriptionBillingStore((s) => s.submitting);
  const error = useSubscriptionBillingStore((s) => s.error);
  const hydrate = useSubscriptionBillingStore((s) => s.hydrate);
  const submitClaim = useSubscriptionBillingStore((s) => s.submitClaim);
  const activateFree = useSubscriptionBillingStore((s) => s.activateFree);

  const [planId, setPlanId] = useState("");
  const [momoReference, setMomoReference] = useState("");
  const [payerName, setPayerName] = useState("");
  const [payerNumber, setPayerNumber] = useState("");
  const [notes, setNotes] = useState("");

  usePageLoading(loading || submitting, "settings-subscription");

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (error) {
      showToast(error, "error");
    }
  }, [error, showToast]);

  useEffect(() => {
    if (!planId && (snapshot?.plan?.id || plans[0]?.id)) {
      setPlanId(snapshot?.plan?.id || plans[0]?.id || "");
    }
  }, [planId, plans, snapshot?.plan?.id]);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === planId) ?? snapshot?.plan ?? null,
    [planId, plans, snapshot?.plan]
  );

  const products = snapshot?.subscribedModules?.length
    ? snapshot.subscribedModules
    : subscribedModules ?? [];
  const activeAddons = snapshot?.subscribedAddons?.length
    ? snapshot.subscribedAddons
    : subscribedAddons ?? [];
  const billingStatus = snapshot?.billingStatus ?? "none";
  const pay = snapshot?.payInstructions;
  const momoReady = Boolean(pay?.momoNumber?.trim());
  const pendingClaim = snapshot?.claims.find((c) => c.status === "pending");
  const includeSetupFee =
    !snapshot?.periodStart ||
    !(snapshot?.claims ?? []).some((claim) => claim.status === "approved");
  const selectedIsFree = isFreeSubscriptionPlan(selectedPlan);
  const payableAmount = selectedPlan
    ? subscriptionClaimAmountGhs(selectedPlan, { includeSetupFee })
    : null;

  async function handleStartFreeMonth() {
    try {
      await activateFree();
      showToast("Free month started — you only pay SMS usage", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not start free plan", "error");
    }
  }

  async function handleSubmitClaim(e: React.FormEvent) {
    e.preventDefault();
    if (selectedIsFree) {
      await handleStartFreeMonth();
      return;
    }
    if (!momoReady) {
      showToast("MoMo pay-to details are not configured yet", "error");
      return;
    }
    if (!planId) {
      showToast("Select a plan", "error");
      return;
    }
    try {
      await submitClaim({
        planId,
        momoReference,
        payerName,
        payerNumber,
        notes: notes.trim() || undefined
      });
      setMomoReference("");
      setNotes("");
      showToast("Payment claim submitted — waiting for platform approval", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Submit failed", "error");
    }
  }

  return (
    <div className="settings-subscription-workspace workspace-animate-in">
      <header className="role-workspace__hero role-workspace--slate">
        <div className="role-workspace__hero-head">
          <div>
            <p className="eyebrow">Billing</p>
            <h2>Product subscription</h2>
            <p className="muted">
              Plan, renewal dates, and MoMo payment for your company workspace.
            </p>
          </div>
          <div className="role-workspace__hero-tools">
            <span
              className={`status-pill status-pill--${
                billingStatus === "active"
                  ? "active"
                  : billingStatus === "suspended" || billingStatus === "grace"
                    ? "inactive"
                    : "pending"
              }`}
            >
              {TENANT_BILLING_STATUS_LABELS[billingStatus]}
            </span>
            <span
              className={`status-pill status-pill--${
                snapshot?.subscriptionStatus === "active" ? "active" : "inactive"
              }`}
            >
              System {snapshot?.subscriptionStatus ?? "—"}
            </span>
          </div>
        </div>
      </header>

      {snapshot?.bannerMessage ? (
        <div
          className={`subscription-banner subscription-banner--${
            billingStatus === "suspended" ? "danger" : billingStatus === "grace" ? "warn" : "info"
          }`}
          role="status"
        >
          {snapshot.bannerMessage}
        </div>
      ) : null}

      <section className="kpi-grid">
        <article className="kpi-card kpi-card--primary">
          <p className="kpi-label">Plan</p>
          <p className="kpi-value kpi-value--sm">{snapshot?.plan?.name ?? "No plan"}</p>
          <p className="muted">
            {snapshot?.plan
              ? `${formatMoney(snapshot.plan.priceGhs)} / ${snapshot.plan.interval}`
              : "Choose a plan to renew"}
          </p>
        </article>
        <article className="kpi-card kpi-card--success">
          <p className="kpi-label">Period start</p>
          <p className="kpi-value kpi-value--sm">{snapshot?.periodStart ?? "—"}</p>
        </article>
        <article className="kpi-card kpi-card--warning">
          <p className="kpi-label">Renewal / end date</p>
          <p className="kpi-value kpi-value--sm">{snapshot?.periodEnd ?? "—"}</p>
          <p className="muted">
            {snapshot?.daysRemaining != null
              ? `${snapshot.daysRemaining} day${snapshot.daysRemaining === 1 ? "" : "s"} left`
              : snapshot?.daysOverdue != null
                ? `${snapshot.daysOverdue} day${snapshot.daysOverdue === 1 ? "" : "s"} overdue`
                : "No period set"}
          </p>
        </article>
        <article className="kpi-card">
          <p className="kpi-label">Grace</p>
          <p className="kpi-value kpi-value--sm">
            {snapshot?.graceDay != null ? `Day ${snapshot.graceDay} of 3` : "—"}
          </p>
          <p className="muted">Warn → SMS day 2 → suspend day 3</p>
        </article>
      </section>

      <div className="settings-subscription-grid">
        <article className="card" id="subscription-products">
          <h2>Included products</h2>
          <p className="muted">Products and add-ons on your current subscription.</p>
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
          {products.length === 0 ? <p className="muted">No product modules assigned yet.</p> : null}

          <h3 className="settings-section-title">Feature add-ons</h3>
          {activeAddons.length === 0 ? (
            <p className="muted">No add-ons on this plan.</p>
          ) : (
            <ul className="subscription-addon-list">
              {activeAddons.map((addon) => (
                <li key={addon}>
                  <strong>{ADDON_LABELS[addon]}</strong>
                  <span className="status-pill status-pill--active">Active</span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="card" id="subscription-renew">
          <h2>Renew with MoMo</h2>
          <p className="muted">
            Pay the plan amount to the platform MoMo number, then submit your transaction reference for
            approval.
          </p>

          {!momoReady && !selectedIsFree ? (
            <div className="subscription-empty" role="status">
              <strong>MoMo pay-to is not set up yet</strong>
              <p className="muted">
                Ask platform support to save the MoMo number under Platform → Subscription management.
                You can still start the free plan below, or submit a paid claim after MoMo is configured.
              </p>
              {plans.some((plan) => isFreeSubscriptionPlan(plan)) ? (
                <div className="subscription-claim-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={submitting}
                    onClick={() => {
                      const free = plans.find((plan) => isFreeSubscriptionPlan(plan));
                      if (free) setPlanId(free.id);
                      void handleStartFreeMonth();
                    }}
                  >
                    {submitting ? "Starting…" : "Start free month"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : pendingClaim ? (
            <div className="subscription-pending-note" role="status">
              <strong>Payment claim pending</strong>
              <p>
                Ref <strong>{pendingClaim.momoReference}</strong> · {formatMoney(pendingClaim.amountGhs)}
              </p>
              <p className="muted">Waiting for platform approval. Your system goes live after approval.</p>
            </div>
          ) : (
            <>
              <form className="subscription-claim-form" onSubmit={(e) => void handleSubmitClaim(e)}>
                <p className="subscription-step-label">1. Choose package</p>
                <p className="muted subscription-sms-note">
                  Package fees are enrollment / seat charges. SMS is usage-based via Arkesel and billed
                  separately when that add-on is active.
                </p>

                <div className="subscription-plan-picker" role="listbox" aria-label="Subscription package">
                  {plans
                    .filter((plan) => plan.isActive !== false && !plan.id.startsWith("plan-"))
                    .map((plan) => {
                      const selected = plan.id === planId;
                      const tierLabel =
                        SUBSCRIPTION_PACKAGE_TIER_LABELS[plan.packageTier ?? "standard"] ?? "Package";
                      const bullets = (plan.featureBullets ?? []).filter(
                        (bullet) => !/sms alerts billed separately/i.test(bullet)
                      );
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={`subscription-plan-option${selected ? " is-selected" : ""}`}
                          onClick={() => setPlanId(plan.id)}
                        >
                          <span className="subscription-plan-tier">{tierLabel}</span>
                          <strong>{plan.name}</strong>
                          <span className="subscription-plan-price">
                            {isFreeSubscriptionPlan(plan)
                              ? "Free for 1 month"
                              : `${plan.isCustom ? "from " : ""}${formatMoney(plan.priceGhs)} / ${plan.interval}`}
                          </span>
                          <span className="subscription-plan-setup">
                            {isFreeSubscriptionPlan(plan)
                              ? "No setup fee · SMS usage paid separately"
                              : `Setup fee: ${plan.isCustom ? "from " : ""}${formatMoney(plan.setupFeeGhs ?? 0)}`}
                          </span>
                          {bullets.length > 0 ? (
                            <ul className="subscription-plan-bullets">
                              {bullets.map((bullet) => (
                                <li key={bullet}>{bullet}</li>
                              ))}
                            </ul>
                          ) : null}
                        </button>
                      );
                    })}
                </div>

                {selectedIsFree ? (
                  <div className="subscription-momo-box">
                    <p className="subscription-step-label">2. Start free month</p>
                    <p className="muted subscription-amount-breakdown">
                      No MoMo package payment. You get 1 branch, 10 users, 10 mobilizers, and 1,000
                      active customers with unlimited platform use for one month. SMS is billed only
                      when you send messages.
                    </p>
                    <div className="subscription-claim-actions">
                      <button
                        type="button"
                        className="button primary"
                        disabled={submitting}
                        onClick={() => void handleStartFreeMonth()}
                      >
                        {submitting ? "Starting…" : "Start free month"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="subscription-momo-box">
                      <p className="subscription-step-label">2. Send MoMo</p>
                      <div className="subscription-momo-grid">
                        <div>
                          <span className="muted">Pay to</span>
                          <strong>{pay?.momoAccountName || "Platform MoMo"}</strong>
                        </div>
                        <div>
                          <span className="muted">Number</span>
                          <strong className="subscription-momo-number">{pay?.momoNumber}</strong>
                        </div>
                        <div>
                          <span className="muted">Network</span>
                          <strong>{pay?.momoNetwork || "MTN"}</strong>
                        </div>
                        <div>
                          <span className="muted">Pay now</span>
                          <strong>{payableAmount != null ? formatMoney(payableAmount) : "—"}</strong>
                        </div>
                      </div>
                      {selectedPlan ? (
                        <p className="muted subscription-amount-breakdown">
                          {includeSetupFee
                            ? `First enrollment: ${formatMoney(selectedPlan.priceGhs)} package + ${formatMoney(selectedPlan.setupFeeGhs ?? 0)} setup`
                            : `Renewal: ${formatMoney(selectedPlan.priceGhs)} monthly package only`}
                        </p>
                      ) : null}
                    </div>

                    <p className="subscription-step-label">3. Confirm payment</p>

                    <label className="field">
                      <span>MoMo transaction ID / reference</span>
                      <input
                        value={momoReference}
                        onChange={(e) => setMomoReference(e.target.value)}
                        placeholder="e.g. 1234567890"
                        required
                      />
                    </label>
                    <div className="subscription-claim-row">
                      <label className="field">
                        <span>Payer name</span>
                        <input value={payerName} onChange={(e) => setPayerName(e.target.value)} required />
                      </label>
                      <label className="field">
                        <span>MoMo number used</span>
                        <input
                          value={payerNumber}
                          onChange={(e) => setPayerNumber(e.target.value)}
                          placeholder="0244…"
                          required
                        />
                      </label>
                    </div>
                    <label className="field">
                      <span>Notes (optional)</span>
                      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                    </label>
                    <div className="subscription-claim-actions">
                      <button type="submit" className="button primary" disabled={submitting || !planId}>
                        {submitting ? "Submitting…" : "Submit payment claim"}
                      </button>
                    </div>
                  </>
                )}
              </form>
            </>
          )}
        </article>
      </div>

      <article className="card">
        <h2>Payment history</h2>
        {!snapshot?.claims.length ? (
          <p className="muted">No payment claims yet.</p>
        ) : (
          <div className="lines">
            {snapshot.claims.map((claim) => (
              <div className="line" key={claim.id}>
                <div>
                  <strong>
                    {formatMoney(claim.amountGhs)} · {claim.momoReference}
                  </strong>
                  <small>
                    {claim.createdAt.slice(0, 10)} · {claim.payerName} · {claim.payerNumber}
                  </small>
                  {claim.rejectReason ? <p className="muted">Rejected: {claim.rejectReason}</p> : null}
                </div>
                <span
                  className={`status-pill status-pill--${
                    claim.status === "approved"
                      ? "active"
                      : claim.status === "rejected"
                        ? "inactive"
                        : "pending"
                  }`}
                >
                  {claim.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}
