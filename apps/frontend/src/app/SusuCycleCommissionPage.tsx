import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  SUSU_COMMISSION_BASIS_LABELS,
  SUSU_DEDUCTION_TIMING_LABELS,
  computeAgreedCommissionAmount,
  type SusuCommissionBasis,
  type SusuCommissionDeductionTiming,
  type SusuCommissionEarlyWithdrawal,
  type SusuCommissionPartialAllocation,
  type SusuCommissionRolloverTreatment,
  type SusuDailyContributionMode,
  type UpdateSusuCommissionPolicyInput
} from "@bms/shared";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import type { AppRole } from "./api";
import { useSusuCycleCommissionStore } from "./stores/susuCycleCommissionStore";

type Props = {
  role: AppRole;
};

function money(value: number): string {
  return `GHS ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

const BASIS_HELP: Record<SusuCommissionBasis, string> = {
  first_day:
    "Fee equals that customer’s registered daily Susu amount from registration (classic Susu).",
  fixed: "A fixed GHS amount per cycle for every customer (not based on their daily plan).",
  percentage: "A percent of expected cycle total (registered daily × days).",
  none: "No institutional fee — full contributions stay with the customer."
};

const TIMING_HELP: Record<SusuCommissionDeductionTiming, string> = {
  first_collection: "Take the fee from the first collection(s) until satisfied.",
  cycle_maturity: "Credit full savings during the cycle; take the fee when the cycle completes.",
  withdrawal: "Defer the fee until the customer withdraws."
};

export function SusuCycleCommissionPage({ role }: Props) {
  const { showToast } = useToast();
  const { policy, loading, saving, error, hydrate, startLiveSync, stopLiveSync, save, setPolicy } =
    useSusuCycleCommissionStore(
      useShallow((s) => ({
        policy: s.policy,
        loading: s.loading,
        saving: s.saving,
        error: s.error,
        hydrate: s.hydrate,
        startLiveSync: s.startLiveSync,
        stopLiveSync: s.stopLiveSync,
        save: s.save,
        setPolicy: s.setPolicy
      }))
    );
  const canEdit = role === "admin";
  const [draft, setDraft] = useState<UpdateSusuCommissionPolicyInput | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    hydrate({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync]);

  useEffect(() => {
    if (!policy) {
      return;
    }
    setDraft({
      enabled: policy.enabled,
      dailyContributionMode: policy.dailyContributionMode,
      defaultDailyContributionGhs: policy.defaultDailyContributionGhs,
      cycleDays: policy.cycleDays,
      commissionBasis: policy.commissionBasis,
      commissionFixedAmount: policy.commissionFixedAmount,
      commissionPercent: policy.commissionPercent,
      deductionTiming: policy.deductionTiming,
      rolloverTreatment: policy.rolloverTreatment,
      partialAllocation: policy.partialAllocation,
      earlyWithdrawalPolicy: policy.earlyWithdrawalPolicy,
      effectiveFrom: policy.effectiveFrom
    });
  }, [policy]);

  const preview = useMemo(() => {
    if (!draft) {
      return null;
    }
    // Preview only — live cycles use each customer’s registered daily amount.
    const daily = draft.defaultDailyContributionGhs;
    const agreed = computeAgreedCommissionAmount(draft, daily);
    const expectedGross = daily * draft.cycleDays;
    return {
      daily,
      expectedGross,
      agreed,
      customerNet: Math.max(0, expectedGross - agreed),
      usesCustomerDaily: draft.commissionBasis === "first_day" || draft.commissionBasis === "percentage"
    };
  }, [draft]);

  async function handleSave() {
    if (!draft) {
      return;
    }
    try {
      const saved = await save(draft);
      setPolicy(saved);
      showToast(`Susu cycle fee policy v${saved.version} saved`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed", "error");
    }
  }

  function patch<K extends keyof UpdateSusuCommissionPolicyInput>(
    key: K,
    value: UpdateSusuCommissionPolicyInput[K]
  ) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  if (loading && !draft) {
    return (
      <div className="cycle-fees-page">
        <header className="cycle-fees-hero">
          <div>
            <p className="cycle-fees-hero__eyebrow">Susu · Product rules</p>
            <h1>Susu cycle fees</h1>
            <p className="muted">Loading policy…</p>
          </div>
        </header>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="cycle-fees-page">
        <header className="cycle-fees-hero">
          <div>
            <p className="cycle-fees-hero__eyebrow">Susu · Product rules</p>
            <h1>Susu cycle fees</h1>
            <p className="muted">{error ?? "Policy could not be loaded."}</p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="cycle-fees-page">
      <header className="cycle-fees-hero">
        <div className="cycle-fees-hero__copy">
          <p className="cycle-fees-hero__eyebrow">Susu · Product rules</p>
          <h1>Susu cycle fees</h1>
          <p className="muted">
            Configure contribution cycles and institutional commission for this company. Separate from
            agent payroll. New cycles use the latest version; open cycles keep frozen terms.
          </p>
          {policy ? (
            <p className="cycle-fees-hero__meta">
              <span className={`cycle-fees-pill${draft.enabled ? " is-on" : ""}`}>
                {draft.enabled ? "Enabled" : "Disabled"}
              </span>
              <span className="muted">
                Version v{policy.version} · effective {policy.effectiveFrom}
              </span>
            </p>
          ) : null}
        </div>
        <div className="cycle-fees-hero__actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => setGuideOpen(true)}
          >
            How deductions work
          </button>
          {canEdit ? (
            <button type="button" className="button" disabled={saving} onClick={() => void handleSave()}>
              {saving ? "Saving…" : "Save policy"}
            </button>
          ) : (
            <span className="muted cycle-fees-viewonly">View only — admin can change rules</span>
          )}
        </div>
      </header>

      <div className="kpi-grid cycle-fees-kpis">
        <article className={`kpi-card${draft.enabled ? " kpi-card--primary" : ""}`}>
          <p className="kpi-label">Policy</p>
          <p className="kpi-value">{draft.enabled ? "Active" : "Off"}</p>
          <p className="kpi-meta muted">{draft.cycleDays}-day cycle</p>
        </article>
        {preview ? (
          <>
            <article className="kpi-card">
              <p className="kpi-label">Example daily</p>
              <p className="kpi-value">{money(preview.daily)}</p>
              <p className="kpi-meta muted">
                {preview.usesCustomerDaily
                  ? "Live fee uses each customer’s registered daily"
                  : draft.dailyContributionMode === "fixed"
                    ? "Fixed for all"
                    : "Flexible per customer"}
              </p>
            </article>
            <article className="kpi-card kpi-card--warning">
              <p className="kpi-label">Institution fee</p>
              <p className="kpi-value">{money(preview.agreed)}</p>
              <p className="kpi-meta muted">
                {preview.usesCustomerDaily
                  ? "Example only — real fee = customer daily"
                  : SUSU_COMMISSION_BASIS_LABELS[draft.commissionBasis]}
              </p>
            </article>
            <article className="kpi-card kpi-card--success">
              <p className="kpi-label">Customer net</p>
              <p className="kpi-value">{money(preview.customerNet)}</p>
              <p className="kpi-meta muted">
                of {money(preview.expectedGross)} expected gross
              </p>
            </article>
          </>
        ) : null}
      </div>

      <div className="cycle-fees-layout">
        <section className="card cycle-fees-lifecycle">
          <div className="cycle-fees-lifecycle__col">
            <header className="cycle-fees-panel__head">
              <h2>Contribution cycle</h2>
              <p className="muted">How customers save during a Susu cycle</p>
            </header>

            <label className="cycle-fees-toggle">
              <span>
                <strong>Enable cycle commission</strong>
                <small className="muted">When off, collections credit the customer in full.</small>
              </span>
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={!canEdit}
                onChange={(e) => patch("enabled", e.target.checked)}
              />
            </label>

            <div className="cycle-fees-fields cycle-fees-fields--stack">
              <label className="field">
                <span>Daily contribution</span>
                <select
                  value={draft.dailyContributionMode}
                  disabled={!canEdit}
                  onChange={(e) =>
                    patch("dailyContributionMode", e.target.value as SusuDailyContributionMode)
                  }
                >
                  <option value="flexible">Flexible (per customer)</option>
                  <option value="fixed">Fixed for all</option>
                </select>
              </label>
              <label className="field">
                <span>Fallback / example daily (GHS)</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={draft.defaultDailyContributionGhs}
                  disabled={!canEdit}
                  onChange={(e) => patch("defaultDailyContributionGhs", Number(e.target.value) || 0)}
                />
                <small className="muted">
                  Used only when a customer has no registered daily amount. Commission for
                  first-day / percent basis uses each customer’s registration daily.
                </small>
              </label>
              <label className="field">
                <span>Cycle duration (days)</span>
                <input
                  type="number"
                  min={1}
                  max={366}
                  value={draft.cycleDays}
                  disabled={!canEdit}
                  onChange={(e) => patch("cycleDays", Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            </div>
          </div>

          <div className="cycle-fees-lifecycle__col">
            <header className="cycle-fees-panel__head">
              <h2>When to deduct</h2>
              <p className="muted">Same fee — pick when it leaves the customer</p>
            </header>
            <div
              className="cycle-fees-choice-grid cycle-fees-choice-grid--stack"
              role="radiogroup"
              aria-label="Deduction timing"
            >
              {(Object.keys(SUSU_DEDUCTION_TIMING_LABELS) as SusuCommissionDeductionTiming[]).map(
                (key) => (
                  <label
                    key={key}
                    className={`cycle-fees-choice${draft.deductionTiming === key ? " is-active" : ""}`}
                  >
                    <input
                      type="radio"
                      name="deduction-timing"
                      value={key}
                      checked={draft.deductionTiming === key}
                      disabled={!canEdit}
                      onChange={() => patch("deductionTiming", key)}
                    />
                    <strong>{SUSU_DEDUCTION_TIMING_LABELS[key]}</strong>
                    <p className="muted">{TIMING_HELP[key]}</p>
                  </label>
                )
              )}
            </div>
          </div>

          {preview ? (
            <aside className="cycle-fees-lifecycle__col cycle-fees-preview">
              <header className="cycle-fees-panel__head">
                <h2>Example cycle</h2>
                <p className="muted">
                  {preview.usesCustomerDaily
                    ? "Illustration — each customer’s fee = their registered daily"
                    : "Using your default daily amount"}
                </p>
              </header>
              <ol className="cycle-fees-preview__steps">
                <li>
                  <span>Registered daily (example)</span>
                  <strong>{money(preview.daily)}</strong>
                </li>
                <li>
                  <span>
                    {draft.cycleDays} days · expected gross
                  </span>
                  <strong>{money(preview.expectedGross)}</strong>
                </li>
                <li>
                  <span>Institution commission</span>
                  <strong className="cycle-fees-preview__fee">{money(preview.agreed)}</strong>
                </li>
                <li className="cycle-fees-preview__net">
                  <span>Customer withdrawable</span>
                  <strong>{money(preview.customerNet)}</strong>
                </li>
              </ol>
              <p className="muted cycle-fees-preview__timing">
                Deducted: {SUSU_DEDUCTION_TIMING_LABELS[draft.deductionTiming].toLowerCase()}
              </p>
            </aside>
          ) : null}
        </section>

        <section className="card cycle-fees-panel">
          <header className="cycle-fees-panel__head">
            <h2>Commission basis</h2>
            <p className="muted">One agreed fee per cycle — never charged twice</p>
          </header>
          <div className="cycle-fees-choice-grid" role="radiogroup" aria-label="Commission basis">
            {(Object.keys(SUSU_COMMISSION_BASIS_LABELS) as SusuCommissionBasis[]).map((key) => (
              <label
                key={key}
                className={`cycle-fees-choice${draft.commissionBasis === key ? " is-active" : ""}`}
              >
                <input
                  type="radio"
                  name="commission-basis"
                  value={key}
                  checked={draft.commissionBasis === key}
                  disabled={!canEdit}
                  onChange={() => patch("commissionBasis", key)}
                />
                <strong>{SUSU_COMMISSION_BASIS_LABELS[key]}</strong>
                <p className="muted">{BASIS_HELP[key]}</p>
              </label>
            ))}
          </div>
          <div className="cycle-fees-fields">
            <label className="field">
              <span>Fixed commission (GHS)</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={draft.commissionFixedAmount ?? 0}
                disabled={!canEdit || draft.commissionBasis !== "fixed"}
                onChange={(e) => patch("commissionFixedAmount", Number(e.target.value) || 0)}
              />
            </label>
            <label className="field">
              <span>Commission percent</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={draft.commissionPercent ?? 0}
                disabled={!canEdit || draft.commissionBasis !== "percentage"}
                onChange={(e) => patch("commissionPercent", Number(e.target.value) || 0)}
              />
            </label>
          </div>
        </section>

        <section className="card cycle-fees-panel">
          <header className="cycle-fees-panel__head">
            <h2>Edge cases</h2>
            <p className="muted">Partial payments, rollover, and early exit</p>
          </header>
          <div className="cycle-fees-fields">
            <label className="field">
              <span>Partial payment allocation</span>
              <select
                value={draft.partialAllocation}
                disabled={!canEdit}
                onChange={(e) =>
                  patch("partialAllocation", e.target.value as SusuCommissionPartialAllocation)
                }
              >
                <option value="commission_first">Commission first</option>
                <option value="savings_first">Savings first</option>
                <option value="proportional">Proportional</option>
              </select>
            </label>
            <label className="field">
              <span>Rollover treatment</span>
              <select
                value={draft.rolloverTreatment}
                disabled={!canEdit}
                onChange={(e) =>
                  patch("rolloverTreatment", e.target.value as SusuCommissionRolloverTreatment)
                }
              >
                <option value="deduct">Deduct on rollover</option>
                <option value="defer">Defer until withdrawal</option>
                <option value="waive">Waive</option>
              </select>
            </label>
            <label className="field">
              <span>Early withdrawal</span>
              <select
                value={draft.earlyWithdrawalPolicy}
                disabled={!canEdit}
                onChange={(e) =>
                  patch("earlyWithdrawalPolicy", e.target.value as SusuCommissionEarlyWithdrawal)
                }
              >
                <option value="deduct_full">Deduct full fee</option>
                <option value="deduct_pro_rata">Pro-rata fee</option>
                <option value="waive">Waive fee</option>
                <option value="block">Block early withdrawal</option>
              </select>
            </label>
          </div>
          <p className="cycle-fees-footnote muted">
            Fees post to the <strong>Institutional income</strong> account. Agent payroll commissions
            stay under Agent commissions.
          </p>
        </section>
      </div>

      <Modal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Susu cycle & commission deduction guide"
        subtitle="Reference for full, partial, early withdrawals, red-line cancelled pages, and Balance Brought Forward (BBF)."
        panelClassName="modal-panel--70"
        footer={
          <button type="button" className="button" onClick={() => setGuideOpen(false)}>
            Got it
          </button>
        }
      >
        <div className="cycle-guide">
          <section className="cycle-guide__section">
            <h3>1. When commission is deducted</h3>
            <ul>
              <li>
                <strong>First collection (Box #1):</strong> Commission is taken as soon as the customer
                starts a new card. Remaining boxes (Box #2–#{draft.cycleDays}) go 100% to customer
                savings.
              </li>
              <li>
                <strong>Cycle maturity (Box #{draft.cycleDays}):</strong> Full deposits credit to
                savings during the cycle; the agreed fee is deducted when the final box of the card
                completes.
              </li>
              <li>
                <strong>Customer withdrawal (Deferred):</strong> No fee is taken while depositing.
                Commission is settled when the customer withdraws, using strict{" "}
                <strong>FIFO (oldest pages first)</strong> below.
              </li>
            </ul>
          </section>

          <section className="cycle-guide__section">
            <h3>2. Full vs. partial withdrawal (FIFO order)</h3>
            <p className="muted">
              When a customer has completed earlier pages (e.g. Pages #1–#48) plus an incomplete
              active page (e.g. Page #49 at 22/{draft.cycleDays} boxes), withdrawals draw in this
              exact order:
            </p>
            <ol>
              <li>
                <strong>Balance Brought Forward (BBF) first:</strong> Any leftover balance carried
                from previously cancelled cards is spent first with <strong>GHS 0 extra fee</strong>.
              </li>
              <li>
                <strong>Completed pages oldest-first (Pages #1 → #48):</strong> As soon as any
                withdrawal touches a completed page (even a partial withdrawal, e.g. GHS 100 from a
                GHS 155 Page #1), that page is <strong>cancelled immediately with a red line</strong>
                , its fee (GHS 5) is settled once, and its remaining balance (GHS 50) is written as{" "}
                <strong>BBF (Balance Brought Forward)</strong> at the top of the next page (Page #2).
                If the withdrawal fits inside BBF + completed pages, the active incomplete page is{" "}
                <strong>not touched</strong> — it stays open and its deferred commission remains
                untouched.
              </li>
              <li>
                <strong>Jumping into the incomplete active page (Page #49):</strong> If the
                withdrawal exceeds BBF + all completed pages and dips into incomplete Page #49, the
                customer has broken the cycle. Earlier pages (#1–#48) and broken Page #49 are{" "}
                <strong>cancelled with a red line</strong>, and Page #49&apos;s commission is applied
                according to the <em>Early withdrawal</em> rule.
              </li>
            </ol>
          </section>

          <section className="cycle-guide__section">
            <h3>3. Commission charged &ldquo;on top&rdquo; of withdrawal</h3>
            <p>
              When commission applies at withdrawal, it is charged <strong>on top</strong> of the
              requested payout amount whenever the customer&apos;s withdrawable balance covers both:
            </p>
            <div className="cycle-guide__example">
              <strong>Example:</strong> Customer requests <strong>GHS 30.00</strong> and Page #49 has
              a <strong>GHS 5.00</strong> cycle fee → customer receives <strong>GHS 30.00</strong>,
              and the account is debited <strong>GHS 35.00</strong> (<code>30 + 5</code>). If
              available balance is below GHS 35.00, the withdrawal is declined with the exact shortfall.
            </div>
          </section>

          <section className="cycle-guide__section">
            <h3>4. Cancelled pages (red line) &amp; Balance Brought Forward (BBF)</h3>
            <ul>
              <li>
                <strong>Red line crossing cancelled pages:</strong> Every settled or early-broken
                page is marked <strong>Cancelled</strong> with a diagonal red line across the boxes
                so no further deposits tick into that page.
              </li>
              <li>
                <strong>Balance Brought Forward (BBF):</strong> Any money remaining from the broken
                page after deducting the withdrawal and fee moves to the top of the brand-new next
                card (e.g. Page #50) as a <strong>BBF</strong> banner.
              </li>
              <li>
                <strong>New card starts fresh at 0 / {draft.cycleDays}:</strong> BBF{" "}
                <strong>never</strong> auto-checks boxes on Page #50. It simply tells staff there is
                carried-over balance from previous cancelled pages while the customer begins a new
                cycle.
              </li>
            </ul>
          </section>

          <section className="cycle-guide__section">
            <h3>5. Policy options reference</h3>
            <div className="cycle-guide__grid">
              <div>
                <h4>Early withdrawal (breaking an incomplete page)</h4>
                <ul>
                  <li>
                    <strong>Deduct full fee:</strong> Takes the full agreed cycle commission.
                  </li>
                  <li>
                    <strong>Pro-rata fee:</strong> Charges proportionally based on boxes checked ÷{" "}
                    {draft.cycleDays}.
                  </li>
                  <li>
                    <strong>Waive fee:</strong> Cancels the page with GHS 0 fee.
                  </li>
                  <li>
                    <strong>Block early withdrawal:</strong> Prevents dipping into an incomplete page
                    until all {draft.cycleDays} boxes finish.
                  </li>
                </ul>
              </div>
              <div>
                <h4>Partial payment &amp; rollover rules</h4>
                <ul>
                  <li>
                    <strong>Commission first:</strong> Underpayments on Box #1 satisfy the fee before
                    savings.
                  </li>
                  <li>
                    <strong>Savings first:</strong> Underpayments credit savings first; fee waits.
                  </li>
                  <li>
                    <strong>Proportional:</strong> Splits underpayment between fee and savings.
                  </li>
                  <li>
                    <strong>Rollover (Deduct / Defer / Waive):</strong> Controls how unpaid fees on a
                    completed card are handled when the customer rolls into the next card.
                  </li>
                </ul>
              </div>
            </div>
          </section>
        </div>
      </Modal>
    </div>
  );
}
