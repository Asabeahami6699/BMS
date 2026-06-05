import { useMemo, useState } from "react";
import type { AppRole, CommissionPolicy } from "./api";
import { updateCommissionPolicy } from "./api";
import { useToast } from "../components/Toast";
import { useCommissionLiveSync } from "./hooks/useCommissionLiveSync";
import { useCommissionStore } from "./stores/commissionStore";

type Props = {
  role: AppRole;
};

type BonusRule = CommissionPolicy["bonusRules"][number];

const BASIS_OPTIONS: Array<{
  value: CommissionPolicy["basis"];
  label: string;
  description: string;
}> = [
  {
    value: "gross_collections",
    label: "Gross collections",
    description: "Commission on all daily Susu and deposits recorded by the agent."
  },
  {
    value: "net_collections",
    label: "Net collections",
    description: "Commission after withdrawals and adjustments (when net reporting is enabled)."
  }
];

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function computeSampleCommission(
  policy: CommissionPolicy,
  sampleCollections: number
): { base: number; bonuses: number; total: number } {
  if (!policy.enabled || sampleCollections <= 0) {
    return { base: 0, bonuses: 0, total: 0 };
  }
  const base = (sampleCollections * policy.fieldAgentCommissionPercent) / 100;
  const bonuses = policy.bonusRules.reduce((sum, rule) => {
    return sampleCollections >= rule.threshold ? sum + rule.amount : sum;
  }, 0);
  return { base, bonuses, total: base + bonuses };
}

export function CommissionPolicyCard({ role }: Props) {
  useCommissionLiveSync();
  const { showToast } = useToast();
  const policy = useCommissionStore((s) => s.policy);
  const loading = useCommissionStore((s) => s.loading);
  const saving = useCommissionStore((s) => s.saving);
  const error = useCommissionStore((s) => s.error);
  const setPolicy = useCommissionStore((s) => s.setPolicy);
  const setSaving = useCommissionStore((s) => s.setSaving);
  const refreshSilent = useCommissionStore((s) => s.refreshSilent);
  const refresh = useCommissionStore((s) => s.refresh);
  const [sampleCollections, setSampleCollections] = useState(10_000);

  const canEdit = role === "admin";
  const initialLoad = loading && policy == null;

  const preview = useMemo(() => {
    if (!policy) {
      return null;
    }
    return computeSampleCommission(policy, sampleCollections);
  }, [policy, sampleCollections]);

  const coordinatorSample = useMemo(() => {
    if (!policy?.enabled || sampleCollections <= 0) {
      return 0;
    }
    return (sampleCollections * policy.coordinatorCommissionPercent) / 100;
  }, [policy, sampleCollections]);

  async function handleSave() {
    if (!policy) {
      return;
    }
    setSaving(true);
    try {
      const updated = await updateCommissionPolicy({
        ...policy,
        fieldAgentCommissionPercent: Number(policy.fieldAgentCommissionPercent),
        coordinatorCommissionPercent: Number(policy.coordinatorCommissionPercent),
        bonusRules: policy.bonusRules.map((r) => ({
          threshold: Number(r.threshold),
          amount: Number(r.amount)
        }))
      });
      setPolicy({ ...updated, bonusRules: updated.bonusRules ?? [] });
      await refreshSilent();
      showToast("Commission policy saved", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save policy", "error");
    } finally {
      setSaving(false);
    }
  }

  function updateBonusRule(index: number, patch: Partial<BonusRule>) {
    if (!policy) {
      return;
    }
    setPolicy({
      ...policy,
      bonusRules: policy.bonusRules.map((row, i) => (i === index ? { ...row, ...patch } : row))
    });
  }

  function addBonusRule() {
    if (!policy) {
      return;
    }
    setPolicy({
      ...policy,
      bonusRules: [...policy.bonusRules, { threshold: 5000, amount: 50 }]
    });
  }

  function removeBonusRule(index: number) {
    if (!policy) {
      return;
    }
    setPolicy({
      ...policy,
      bonusRules: policy.bonusRules.filter((_, i) => i !== index)
    });
  }

  if (initialLoad) {
    return (
      <div className="agents-page">
        <header className="agents-page__header">
          <div>
            <h2>Commissions</h2>
            <p className="muted">Loading policy…</p>
          </div>
        </header>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="agents-page">
        <header className="agents-page__header">
          <div>
            <h2>Commissions</h2>
            <p className="muted">{error ?? "Commission policy could not be loaded."}</p>
            <button type="button" className="button secondary" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="agents-page commissions-page">
      <header className="agents-page__header">
        <div>
          <h2>Commissions</h2>
          <p className="muted">
            Configure how field agents and coordinators earn commission on collections. Used on agent
            profiles, payroll, and performance views.
          </p>
        </div>
        <div className="agents-page__header-actions">
          {canEdit ? (
            <button type="button" className="button" disabled={saving} onClick={() => void handleSave()}>
              {saving ? "Saving…" : "Save policy"}
            </button>
          ) : (
            <span className="muted" style={{ fontSize: "0.9rem" }}>
              View only — contact admin to change rates
            </span>
          )}
        </div>
      </header>

      <div className="kpi-grid agents-page__kpis">
        <article className={`kpi-card${policy.enabled ? " kpi-card--primary" : ""}`}>
          <div className="kpi-card-head">
            <span className="kpi-icon" aria-hidden>
              {policy.enabled ? "✓" : "○"}
            </span>
            <span className="kpi-label">Policy status</span>
          </div>
          <p className="kpi-value">{policy.enabled ? "Active" : "Disabled"}</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-card-head">
            <span className="kpi-icon" aria-hidden>
              🚶
            </span>
            <span className="kpi-label">Field agent rate</span>
          </div>
          <p className="kpi-value">
            {policy.fieldAgentCommissionPercent}%
            <span className="kpi-meta"> of {policy.basis === "gross_collections" ? "gross" : "net"}</span>
          </p>
        </article>
        <article className="kpi-card">
          <div className="kpi-card-head">
            <span className="kpi-icon" aria-hidden>
              🧭
            </span>
            <span className="kpi-label">Coordinator rate</span>
          </div>
          <p className="kpi-value">{policy.coordinatorCommissionPercent}%</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-card-head">
            <span className="kpi-icon" aria-hidden>
              🎁
            </span>
            <span className="kpi-label">Bonus tiers</span>
          </div>
          <p className="kpi-value">{policy.bonusRules.length}</p>
        </article>
      </div>

      <div className="commissions-layout">
        <section className="card commissions-panel">
          <h3 className="commissions-panel__title">Policy settings</h3>

          <label className="commission-toggle-row">
            <span>
              <strong>Enable commissions</strong>
              <small className="muted">When off, agents see zero projected commission.</small>
            </span>
            <input
              type="checkbox"
              checked={policy.enabled}
              disabled={!canEdit}
              onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })}
            />
          </label>

          <div className="commissions-fields-grid">
            <label className="field">
              <span>Currency</span>
              <select
                value={policy.currency}
                disabled={!canEdit}
                onChange={(e) => setPolicy({ ...policy, currency: e.target.value })}
              >
                <option value="GHS">GHS — Ghana Cedi</option>
              </select>
            </label>
          </div>

          <fieldset className="commission-basis-fieldset" disabled={!canEdit}>
            <legend>Commission basis</legend>
            <div className="commission-basis-grid">
              {BASIS_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`commission-basis-card${policy.basis === opt.value ? " commission-basis-card--active" : ""}`}
                >
                  <input
                    type="radio"
                    name="commission-basis"
                    value={opt.value}
                    checked={policy.basis === opt.value}
                    disabled={!canEdit}
                    onChange={() => setPolicy({ ...policy, basis: opt.value })}
                  />
                  <strong>{opt.label}</strong>
                  <p className="muted">{opt.description}</p>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="commissions-fields-grid">
            <label className="field">
              <span>Field agent commission (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={policy.fieldAgentCommissionPercent}
                disabled={!canEdit || !policy.enabled}
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    fieldAgentCommissionPercent: Number(e.target.value)
                  })
                }
              />
            </label>
            <label className="field">
              <span>Coordinator commission (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={policy.coordinatorCommissionPercent}
                disabled={!canEdit || !policy.enabled}
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    coordinatorCommissionPercent: Number(e.target.value)
                  })
                }
              />
            </label>
          </div>

          <div className="commissions-bonus-section">
            <div className="commissions-bonus-head">
              <div>
                <h4>Performance bonuses (field agents)</h4>
                <p className="muted">
                  Flat bonus amounts added when monthly collections reach each threshold.
                </p>
              </div>
              {canEdit ? (
                <button type="button" className="button secondary" onClick={addBonusRule}>
                  Add tier
                </button>
              ) : null}
            </div>

            {policy.bonusRules.length === 0 ? (
              <p className="muted commissions-bonus-empty">No bonus tiers configured.</p>
            ) : (
              <div className="commissions-bonus-table-wrap">
                <table className="commissions-bonus-table">
                  <thead>
                    <tr>
                      <th>When collections reach</th>
                      <th>Bonus amount</th>
                      {canEdit ? <th aria-label="Actions" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {policy.bonusRules.map((rule, index) => (
                      <tr key={index}>
                        <td>
                          <input
                            type="number"
                            min={0}
                            step={100}
                            value={rule.threshold}
                            disabled={!canEdit}
                            onChange={(e) =>
                              updateBonusRule(index, { threshold: Number(e.target.value) })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={rule.amount}
                            disabled={!canEdit}
                            onChange={(e) =>
                              updateBonusRule(index, { amount: Number(e.target.value) })
                            }
                          />
                        </td>
                        {canEdit ? (
                          <td>
                            <button
                              type="button"
                              className="button secondary"
                              onClick={() => removeBonusRule(index)}
                            >
                              Remove
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="card commissions-panel">
          <h3 className="commissions-panel__title">Calculation preview</h3>
          <p className="muted">
            Example using current rates. Agents see projected commission on their profile based on
            actual collections this month.
          </p>

          <label className="field">
            <span>Sample monthly collections ({policy.currency})</span>
            <input
              type="number"
              min={0}
              step={500}
              value={sampleCollections}
              onChange={(e) => setSampleCollections(Math.max(0, Number(e.target.value)))}
            />
          </label>

          <div className="credentials-panel commissions-preview-box">
            <p className="credentials-panel-title">Field agent (example)</p>
            {policy.enabled && preview ? (
              <ul className="commissions-preview-lines">
                <li>
                  <span>Base ({policy.fieldAgentCommissionPercent}%)</span>
                  <strong>{formatMoney(preview.base, policy.currency)}</strong>
                </li>
                {preview.bonuses > 0 ? (
                  <li>
                    <span>Performance bonuses</span>
                    <strong>{formatMoney(preview.bonuses, policy.currency)}</strong>
                  </li>
                ) : null}
                <li className="commissions-preview-total">
                  <span>Estimated commission</span>
                  <strong>{formatMoney(preview.total, policy.currency)}</strong>
                </li>
              </ul>
            ) : (
              <p className="muted">Commissions disabled or no collections entered.</p>
            )}
          </div>

          <div className="credentials-panel commissions-preview-box">
            <p className="credentials-panel-title">Coordinator (example)</p>
            {policy.enabled ? (
              <p>
                <strong>{formatMoney(coordinatorSample, policy.currency)}</strong>
                <span className="muted">
                  {" "}
                  at {policy.coordinatorCommissionPercent}% of sample collections
                </span>
              </p>
            ) : (
              <p className="muted">Commissions disabled.</p>
            )}
          </div>

          <p className="muted commissions-footnote">
            Per-user base salary, commission overrides, and monthly bonuses are configured under{" "}
            <strong>Payroll</strong>. Tier bonuses apply automatically from the rules above.
          </p>
        </section>
      </div>
    </div>
  );
}
