import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  formatAccountAmount,
  type LoanQualificationPeriodMonths,
  type LoanQualificationSetup
} from "@bms/shared";
import { useToast } from "../../components/Toast";
import { useLoanQualificationStore } from "../stores/loanQualificationStore";

const PERIOD_OPTIONS: { value: LoanQualificationPeriodMonths; label: string; hint: string }[] = [
  { value: 1, label: "1 month", hint: "Faster path" },
  { value: 3, label: "3 months", hint: "Balanced" },
  { value: 6, label: "6 months", hint: "Strictest" }
];

export function SettingsLoanQualificationPage() {
  const { showToast } = useToast();
  const { setup, loading, saving, error, unavailable, lastFetchedAt, hydrate, setSetup, save } =
    useLoanQualificationStore(
      useShallow((s) => ({
        setup: s.setup,
        loading: s.loading,
        saving: s.saving,
        error: s.error,
        unavailable: s.unavailable,
        lastFetchedAt: s.lastFetchedAt,
        hydrate: s.hydrate,
        setSetup: s.setSetup,
        save: s.save
      }))
    );

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const summary = useMemo(() => {
    const badge = setup.badgeLabel.trim() || "Loan ready";
    return {
      badge,
      period: `${setup.periodMonths} month${setup.periodMonths === 1 ? "" : "s"}`,
      exampleMax: formatAccountAmount(setup.minAccountBalanceGhs * setup.maxLoanMultipleOfBalance)
    };
  }, [setup]);

  function patch(partial: Partial<LoanQualificationSetup>) {
    setSetup({ ...setup, ...partial });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      await save(setup);
      showToast("Loan qualification setup saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save", "error");
    }
  }

  if (loading && lastFetchedAt == null) {
    return (
      <article className="card loan-qual-setup">
        <div className="loan-qual-setup__head">
          <div>
            <h2>Loan qualification</h2>
            <p className="muted">Loading your company rules…</p>
          </div>
        </div>
      </article>
    );
  }

  if (unavailable) {
    return (
      <article className="card loan-qual-setup">
        <div className="loan-qual-setup__head">
          <div>
            <h2>Loan qualification</h2>
            <p className="muted">
              Enable Susu Management, Loans, and the Susu↔Loans bridge in Company Profile to configure
              qualification.
            </p>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="card loan-qual-setup">
      <div className="loan-qual-setup__head">
        <div>
          <h2>Loan qualification</h2>
          <p className="muted">
            Customers who keep a steady Susu balance earn a badge and optional SMS. These rules also set
            passbook collateral and Susu disbursement.
          </p>
        </div>
        <label className={`loan-qual-setup__power ${setup.enabled ? "is-on" : ""}`}>
          <input
            type="checkbox"
            checked={setup.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          <span className="loan-qual-setup__power-ui" aria-hidden>
            <span className="loan-qual-setup__power-knob" />
          </span>
          <span className="loan-qual-setup__power-copy">
            <strong>{setup.enabled ? "Automatic qualification on" : "Automatic qualification off"}</strong>
            <small>{setup.enabled ? "Badges update on the scan schedule" : "No new badges or qualify SMS"}</small>
          </span>
        </label>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <form className="loan-qual-setup__layout" onSubmit={(e) => void handleSave(e)}>
        <div className="loan-qual-setup__main">
          <section className="loan-qual-setup__panel">
            <header className="loan-qual-setup__panel-head">
              <h3>Consistency period</h3>
              <p className="muted">How far back to measure Susu activity.</p>
            </header>
            <div className="loan-qual-setup__period" role="radiogroup" aria-label="Consistency period">
              {PERIOD_OPTIONS.map((opt) => {
                const active = setup.periodMonths === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`loan-qual-setup__period-btn ${active ? "is-active" : ""}`}
                    onClick={() => patch({ periodMonths: opt.value })}
                    disabled={!setup.enabled}
                  >
                    <strong>{opt.label}</strong>
                    <span>{opt.hint}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="loan-qual-setup__panel">
            <header className="loan-qual-setup__panel-head">
              <h3>Qualification thresholds</h3>
              <p className="muted">
                Think of these as three checks on the same customer. The system looks only inside the
                consistency period you chose above (for example the last 3 months). The customer must
                pass <strong>all three</strong> before they get the badge.
              </p>
            </header>

            <div className="loan-qual-setup__explain">
              <article className="loan-qual-setup__explain-card">
                <label className="field">
                  <span>1. Minimum Susu days</span>
                  <input
                    type="number"
                    min={0}
                    max={366}
                    disabled={!setup.enabled}
                    value={setup.minCollectionDays}
                    onChange={(e) => patch({ minCollectionDays: Number(e.target.value) || 0 })}
                  />
                </label>
                <p>
                  How many separate days the customer must have posted a <strong>daily Susu</strong>{" "}
                  collection in the period. Example: <em>15</em> means at least 15 Susu collection
                  days — not calendar days with zero activity.
                </p>
              </article>

              <article className="loan-qual-setup__explain-card">
                <label className="field">
                  <span>2. Minimum account balance</span>
                  <div className="loan-qual-setup__money">
                    <span>GHS</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={!setup.enabled}
                      value={setup.minAccountBalanceGhs}
                      onChange={(e) =>
                        patch({ minAccountBalanceGhs: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                </label>
                <p>
                  The customer’s <strong>current Susu/savings ledger balance</strong> must be at least
                  this amount when the scan runs. Example: <em>GHS 100</em> means they still have
                  GHS 100 or more sitting on the account today — not only that they once deposited
                  that much.
                </p>
              </article>

              <article className="loan-qual-setup__explain-card">
                <label className="field">
                  <span>3. Minimum Susu total</span>
                  <div className="loan-qual-setup__money">
                    <span>GHS</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={!setup.enabled}
                      value={setup.minSusuTotalGhs}
                      onChange={(e) => patch({ minSusuTotalGhs: Number(e.target.value) || 0 })}
                    />
                  </div>
                </label>
                <p>
                  The <strong>sum of all daily Susu collections</strong> in the period must reach this
                  amount. Example: <em>GHS 200</em> means their Susu credits in those months add up to
                  at least GHS 200, even if they later withdrew some of it.
                </p>
              </article>
            </div>

            <p className="loan-qual-setup__example muted">
              Example with your numbers: in the last {setup.periodMonths} month
              {setup.periodMonths === 1 ? "" : "s"}, a customer needs ≥ {setup.minCollectionDays} Susu
              days, a balance of ≥ GHS {formatAccountAmount(setup.minAccountBalanceGhs)} now, and ≥ GHS{" "}
              {formatAccountAmount(setup.minSusuTotalGhs)} total Susu collected. Miss any one → no
              badge.
            </p>
          </section>

          <section className="loan-qual-setup__panel">
            <header className="loan-qual-setup__panel-head">
              <h3>Loan offer & collateral</h3>
              <p className="muted">Applied when a qualified customer’s loan is disbursed.</p>
            </header>
            <div className="loan-qual-setup__grid">
              <label className="field">
                <span>Passbook collateral</span>
                <div className="loan-qual-setup__money">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={setup.collateralPercent}
                    onChange={(e) => patch({ collateralPercent: Number(e.target.value) || 0 })}
                  />
                  <span>%</span>
                </div>
                <small className="muted">Share of existing Susu locked for the loan term</small>
              </label>
              <label className="field">
                <span>Suggested max loan</span>
                <div className="loan-qual-setup__money">
                  <span>×</span>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step="0.1"
                    disabled={!setup.enabled}
                    value={setup.maxLoanMultipleOfBalance}
                    onChange={(e) =>
                      patch({ maxLoanMultipleOfBalance: Number(e.target.value) || 0 })
                    }
                  />
                </div>
                <small className="muted">Multiple of account balance</small>
              </label>
              <label className="field">
                <span>Badge label</span>
                <input
                  maxLength={40}
                  disabled={!setup.enabled}
                  value={setup.badgeLabel}
                  onChange={(e) => patch({ badgeLabel: e.target.value })}
                  placeholder="Loan ready"
                />
              </label>
            </div>

            <div className="loan-qual-setup__toggles">
              <label className={`loan-qual-setup__toggle ${setup.disburseToSusu ? "is-on" : ""}`}>
                <input
                  type="checkbox"
                  checked={setup.disburseToSusu}
                  onChange={(e) => patch({ disburseToSusu: e.target.checked })}
                />
                <span className="loan-qual-setup__toggle-ui" aria-hidden>
                  <span className="loan-qual-setup__toggle-knob" />
                </span>
                <span>
                  <strong>Disburse into Susu</strong>
                  <small>Credit principal so the customer can withdraw at the branch counter</small>
                </span>
              </label>
              <label
                className={`loan-qual-setup__toggle ${setup.notifyOnQualifySms ? "is-on" : ""} ${
                  !setup.enabled ? "is-disabled" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={setup.notifyOnQualifySms}
                  disabled={!setup.enabled}
                  onChange={(e) => patch({ notifyOnQualifySms: e.target.checked })}
                />
                <span className="loan-qual-setup__toggle-ui" aria-hidden>
                  <span className="loan-qual-setup__toggle-knob" />
                </span>
                <span>
                  <strong>SMS on qualify</strong>
                  <small>One message the first time a customer meets these rules</small>
                </span>
              </label>
            </div>
          </section>

          <div className="form-actions loan-qual-setup__actions">
            <button type="submit" className="button" disabled={saving}>
              {saving ? "Saving…" : "Save setup"}
            </button>
          </div>
        </div>

        <aside className="loan-qual-setup__preview" aria-label="Qualification preview">
          <p className="loan-qual-setup__preview-eyebrow">Customer preview</p>
          <div className="loan-qual-setup__preview-card">
            <div className="loan-qual-setup__preview-row">
              <span className="muted">Status</span>
              {setup.enabled ? (
                <span className="status-pill status-pill--active">{summary.badge}</span>
              ) : (
                <span className="status-pill status-pill--pending">Off</span>
              )}
            </div>
            <div className="loan-qual-setup__preview-row">
              <span className="muted">Lookback</span>
              <strong>{summary.period}</strong>
            </div>
            <div className="loan-qual-setup__preview-row">
              <span className="muted">Need at least</span>
              <strong>
                {setup.minCollectionDays} days · GHS {formatAccountAmount(setup.minAccountBalanceGhs)}{" "}
                balance · GHS {formatAccountAmount(setup.minSusuTotalGhs)} Susu
              </strong>
            </div>
            <div className="loan-qual-setup__preview-row">
              <span className="muted">Example max loan</span>
              <strong>GHS {summary.exampleMax}</strong>
            </div>
            <div className="loan-qual-setup__preview-row">
              <span className="muted">Collateral lock</span>
              <strong>{setup.collateralPercent}% of Susu</strong>
            </div>
            <ul className="loan-qual-setup__preview-flags">
              <li className={setup.disburseToSusu ? "is-on" : ""}>
                {setup.disburseToSusu ? "Disburses to Susu" : "Cash disbursement only"}
              </li>
              <li className={setup.enabled && setup.notifyOnQualifySms ? "is-on" : ""}>
                {setup.enabled && setup.notifyOnQualifySms
                  ? "Qualify SMS enabled"
                  : "Qualify SMS off"}
              </li>
            </ul>
          </div>
        </aside>
      </form>
    </article>
  );
}
