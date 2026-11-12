import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  AppRole,
  CashVarianceCase,
  CashVarianceSettlementMethod,
  CashVarianceType
} from "./api";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { usePageLoading } from "./hooks/usePageLoading";
import {
  useOveragesShortagesStore,
  type OsSource
} from "./stores/overagesShortagesStore";

type Props = { role: AppRole };

function formatMoney(amount: number): string {
  return `GHS ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sectionTotals(rows: Array<{ varianceType: CashVarianceType; outstandingAmount: number }>) {
  const shortages = rows.filter((c) => c.varianceType === "shortage");
  const overages = rows.filter((c) => c.varianceType === "overage");
  return {
    shortageOutstanding: shortages.reduce((s, c) => s + c.outstandingAmount, 0),
    overageOutstanding: overages.reduce((s, c) => s + c.outstandingAmount, 0),
    shortageCount: shortages.length,
    overageCount: overages.length
  };
}

export function OveragesShortagesPage({ role }: Props) {
  const { showToast } = useToast();
  const fromDate = useOveragesShortagesStore((s) => s.fromDate);
  const toDate = useOveragesShortagesStore((s) => s.toDate);
  const fieldAgentId = useOveragesShortagesStore((s) => s.fieldAgentId);
  const varianceType = useOveragesShortagesStore((s) => s.varianceType);
  const status = useOveragesShortagesStore((s) => s.status);
  const cases = useOveragesShortagesStore((s) => s.cases);
  const tillCases = useOveragesShortagesStore((s) => s.tillCases);
  const customers = useOveragesShortagesStore((s) => s.customers);
  const agents = useOveragesShortagesStore((s) => s.agents);
  const loading = useOveragesShortagesStore((s) => s.loading);
  const busyId = useOveragesShortagesStore((s) => s.busyId);
  const error = useOveragesShortagesStore((s) => s.error);
  const hydrate = useOveragesShortagesStore((s) => s.hydrate);
  const refresh = useOveragesShortagesStore((s) => s.refresh);
  const startLiveSync = useOveragesShortagesStore((s) => s.startLiveSync);
  const stopLiveSync = useOveragesShortagesStore((s) => s.stopLiveSync);
  const setFromDate = useOveragesShortagesStore((s) => s.setFromDate);
  const setToDate = useOveragesShortagesStore((s) => s.setToDate);
  const setFieldAgentId = useOveragesShortagesStore((s) => s.setFieldAgentId);
  const setVarianceType = useOveragesShortagesStore((s) => s.setVarianceType);
  const setStatus = useOveragesShortagesStore((s) => s.setStatus);
  const settleField = useOveragesShortagesStore((s) => s.settleField);
  const settleTill = useOveragesShortagesStore((s) => s.settleTill);
  const creditCustomer = useOveragesShortagesStore((s) => s.creditCustomer);

  const [actionId, setActionId] = useState<string | null>(null);
  const [actionSource, setActionSource] = useState<OsSource | null>(null);
  const [actionMode, setActionMode] = useState<"settle" | "credit" | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<CashVarianceSettlementMethod>("cash_repayment");
  const [notes, setNotes] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");

  usePageLoading(loading || busyId !== null, "overages-shortages");

  useEffect(() => {
    hydrate({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync]);

  useEffect(() => {
    if (error) {
      showToast(error, "error");
    }
  }, [error, showToast]);

  const fieldTotals = useMemo(() => sectionTotals(cases), [cases]);
  const tillTotals = useMemo(() => sectionTotals(tillCases), [tillCases]);

  const customerMatches = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) {
      return customers.slice(0, 8);
    }
    return customers
      .filter(
        (c) =>
          c.fullName.toLowerCase().includes(q) ||
          (c.accountNumber?.toLowerCase().includes(q) ?? false) ||
          (c.phone?.includes(q) ?? false)
      )
      .slice(0, 12);
  }, [customers, customerQuery]);

  function openSettle(
    source: OsSource,
    v: { id: string; outstandingAmount: number; varianceType: CashVarianceType }
  ) {
    setActionId(v.id);
    setActionSource(source);
    setActionMode("settle");
    setAmount(v.outstandingAmount.toFixed(2));
    setMethod(
      v.varianceType === "shortage"
        ? "cash_repayment"
        : source === "teller_till"
          ? "other"
          : "customer_correction"
    );
    setNotes("");
    setCustomerId("");
    setCustomerQuery("");
  }

  function openCredit(v: CashVarianceCase) {
    setActionId(v.id);
    setActionSource("field_agent");
    setActionMode("credit");
    setAmount(v.outstandingAmount.toFixed(2));
    setNotes("");
    setCustomerId("");
    setCustomerQuery("");
  }

  function closeAction() {
    setActionId(null);
    setActionSource(null);
    setActionMode(null);
  }

  async function handleSettle() {
    if (!actionId || !actionSource) {
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    try {
      const updated =
        actionSource === "teller_till"
          ? await settleTill(actionId, {
              amount: value,
              method,
              notes: notes.trim() || undefined
            })
          : await settleField(actionId, {
              amount: value,
              method,
              notes: notes.trim() || undefined
            });
      showToast(
        updated.status === "settled" || updated.status === "written_off"
          ? "Variance closed"
          : `Partial settlement · outstanding ${formatMoney(updated.outstandingAmount)}`,
        "success"
      );
      closeAction();
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to settle"), "error");
    }
  }

  async function handleCredit() {
    if (!actionId) {
      return;
    }
    const value = Number(amount);
    if (!customerId) {
      showToast("Select the customer to credit", "error");
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      showToast("Enter a valid credit amount", "error");
      return;
    }
    try {
      await creditCustomer(actionId, {
        customerId,
        amount: value,
        notes: notes.trim() || undefined
      });
      showToast("Customer credited · Settled shortage posted to ledger", "success");
      closeAction();
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to credit customer"), "error");
    }
  }

  if (role !== "admin" && role !== "coordinator") {
    return (
      <article className="card">
        <h2>Access restricted</h2>
        <p className="muted">Only coordinators and admins can manage overages and shortages.</p>
      </article>
    );
  }

  return (
    <div className="callover-batches-page">
      <header className="callover-batches-hero">
        <div className="callover-batches-hero__copy">
          <p className="callover-batches-hero__eyebrow">Susu · Cash variances</p>
          <h1>Overages/Shortages</h1>
          <p className="muted">
            Field agent callover and branch teller till cases live on this page in separate sections —
            never mixed or offset against each other.
          </p>
        </div>
        <div className="callover-batches-hero__actions">
          <Link to="/app/susu/callover-batches" className="button secondary">
            Callover batches
          </Link>
          <Link to="/app/susu/till-float" className="button secondary">
            Till float
          </Link>
          <button
            type="button"
            className="button secondary"
            onClick={() => void refresh()}
            disabled={loading || busyId !== null}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <article className="card callover-batches-filters">
        <div className="callover-batches-filters__grid">
          <label className="field">
            <span>From date</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="field">
            <span>To date</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Field agent</span>
            <select value={fieldAgentId} onChange={(e) => setFieldAgentId(e.target.value)}>
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Type</span>
            <select
              value={varianceType}
              onChange={(e) => setVarianceType(e.target.value as "" | CashVarianceType)}
            >
              <option value="">All</option>
              <option value="shortage">Shortage</option>
              <option value="overage">Overage</option>
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as "open" | "all")}>
              <option value="open">Open / partial</option>
              <option value="all">All</option>
            </select>
          </label>
        </div>
      </article>

      <section className="os-source-section" id="os-field-agents">
        <div className="os-source-section__head">
          <div>
            <h2 className="os-source-section__title">Field agents</h2>
            <p className="muted">
              Callover batch cash vs posted total. Shortages are agent debt; overages can credit a
              customer.
            </p>
          </div>
          <div className="os-source-section__kpis">
            <span className="os-source-pill os-source-pill--shortage">
              Shortages {loading ? "—" : formatMoney(fieldTotals.shortageOutstanding)}
              <small>{fieldTotals.shortageCount}</small>
            </span>
            <span className="os-source-pill os-source-pill--overage">
              Overages {loading ? "—" : formatMoney(fieldTotals.overageOutstanding)}
              <small>{fieldTotals.overageCount}</small>
            </span>
          </div>
        </div>

        {cases.length === 0 ? (
          <article className="card callover-batches-empty">
            <p className="muted">{loading ? "Loading…" : "No field agent variances for these filters."}</p>
          </article>
        ) : (
          <div className="callover-variance-list">
            {cases.map((v) => {
              const active = actionId === v.id && actionSource === "field_agent";
              return (
                <article
                  key={v.id}
                  className={`card callover-variance-card callover-variance-card--${v.varianceType}`}
                >
                  <div className="callover-variance-card__head">
                    <div>
                      <div className="callover-variance-card__title-row">
                        <h3>{v.fieldAgentName ?? v.fieldAgentId.slice(0, 8)}</h3>
                        <span className="callover-batch-card__badge">Field agent</span>
                        <span
                          className={`callover-batch-card__badge callover-batch-card__badge--${v.varianceType}`}
                        >
                          {v.varianceType === "shortage" ? "Shortage" : "Overage"}
                        </span>
                      </div>
                      <p className="muted callover-batch-card__meta">
                        {v.businessDate}
                        <span aria-hidden> · </span>
                        Batch {formatMoney(v.batchTotal)} vs cash {formatMoney(v.cashReceived)}
                        <span aria-hidden> · </span>
                        {v.status.replace(/_/g, " ")}
                      </p>
                    </div>
                    <div className="callover-variance-card__amount">
                      <span className="callover-batch-card__stat-label">Outstanding</span>
                      <strong
                        className={
                          v.varianceType === "shortage"
                            ? "callover-batch-card__stat--shortage"
                            : "callover-batch-card__stat--overage"
                        }
                      >
                        {formatMoney(v.outstandingAmount)}
                      </strong>
                    </div>
                  </div>

                  {!active ? (
                    <div className="callover-variance-card__actions">
                      {v.varianceType === "shortage" ? (
                        <button
                          type="button"
                          className="button"
                          disabled={
                            busyId !== null || v.status === "settled" || v.status === "written_off"
                          }
                          onClick={() => openSettle("field_agent", v)}
                        >
                          Record repayment
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="button"
                            disabled={
                              busyId !== null ||
                              v.status === "settled" ||
                              v.status === "written_off"
                            }
                            onClick={() => openCredit(v)}
                          >
                            Credit customer (settled shortage)
                          </button>
                          <button
                            type="button"
                            className="button secondary"
                            disabled={
                              busyId !== null ||
                              v.status === "settled" ||
                              v.status === "written_off"
                            }
                            onClick={() => openSettle("field_agent", v)}
                          >
                            Other reconciliation
                          </button>
                        </>
                      )}
                    </div>
                  ) : actionMode === "credit" ? (
                    <div className="callover-variance-card__settle">
                      <label className="field">
                        <span>Find customer</span>
                        <input
                          type="search"
                          value={customerQuery}
                          onChange={(e) => setCustomerQuery(e.target.value)}
                          placeholder="Name, account, or phone"
                        />
                      </label>
                      <label className="field">
                        <span>Customer</span>
                        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                          <option value="">Select…</option>
                          {customerMatches.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.fullName}
                              {c.accountNumber ? ` · ${c.accountNumber}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Credit amount (GHS)</span>
                        <input
                          type="number"
                          className="input-no-spin"
                          min="0.01"
                          step="0.01"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Notes</span>
                        <input
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="e.g. Card shows GHS 1 missing for this day"
                        />
                      </label>
                      <div className="callover-variance-card__actions">
                        <button
                          type="button"
                          className="button"
                          disabled={busyId !== null}
                          onClick={() => void handleCredit()}
                        >
                          {busyId === v.id ? "Posting…" : "Post settled shortage"}
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busyId !== null}
                          onClick={closeAction}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="callover-variance-card__settle">
                      <label className="field">
                        <span>Amount (GHS)</span>
                        <input
                          type="number"
                          className="input-no-spin"
                          min="0.01"
                          step="0.01"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Method</span>
                        <select
                          value={method}
                          onChange={(e) =>
                            setMethod(e.target.value as CashVarianceSettlementMethod)
                          }
                        >
                          {v.varianceType === "shortage" ? (
                            <>
                              <option value="cash_repayment">Cash repayment</option>
                              <option value="salary_deduction">Salary deduction</option>
                              <option value="write_off">Write-off</option>
                              <option value="other">Other</option>
                            </>
                          ) : (
                            <>
                              <option value="customer_correction">Customer entry correction</option>
                              <option value="write_off">Write-off</option>
                              <option value="other">Other</option>
                            </>
                          )}
                        </select>
                      </label>
                      <label className="field">
                        <span>Notes</span>
                        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
                      </label>
                      <div className="callover-variance-card__actions">
                        <button
                          type="button"
                          className="button"
                          disabled={busyId !== null}
                          onClick={() => void handleSettle()}
                        >
                          {busyId === v.id ? "Saving…" : "Save settlement"}
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busyId !== null}
                          onClick={closeAction}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="os-source-section" id="os-branch-till">
        <div className="os-source-section__head">
          <div>
            <h2 className="os-source-section__title">Branch till (teller)</h2>
            <p className="muted">
              EOD drawer count vs expected till cash. Kept separate from field agent callover —
              shortages are teller debt; overages are excess drawer cash to reconcile.
            </p>
          </div>
          <div className="os-source-section__kpis">
            <span className="os-source-pill os-source-pill--shortage">
              Shortages {loading ? "—" : formatMoney(tillTotals.shortageOutstanding)}
              <small>{tillTotals.shortageCount}</small>
            </span>
            <span className="os-source-pill os-source-pill--overage">
              Overages {loading ? "—" : formatMoney(tillTotals.overageOutstanding)}
              <small>{tillTotals.overageCount}</small>
            </span>
          </div>
        </div>

        {tillCases.length === 0 ? (
          <article className="card callover-batches-empty">
            <p className="muted">
              {loading ? "Loading…" : "No branch till variances for these filters."}
            </p>
          </article>
        ) : (
          <div className="callover-variance-list">
            {tillCases.map((v) => {
              const active = actionId === v.id && actionSource === "teller_till";
              return (
                <article
                  key={v.id}
                  className={`card callover-variance-card callover-variance-card--${v.varianceType}`}
                >
                  <div className="callover-variance-card__head">
                    <div>
                      <div className="callover-variance-card__title-row">
                        <h3>{v.cashierName ?? v.cashierUserId.slice(0, 8)}</h3>
                        <span className="callover-batch-card__badge callover-batch-card__badge--till">
                          Branch till
                        </span>
                        <span
                          className={`callover-batch-card__badge callover-batch-card__badge--${v.varianceType}`}
                        >
                          {v.varianceType === "shortage" ? "Shortage" : "Overage"}
                        </span>
                      </div>
                      <p className="muted callover-batch-card__meta">
                        {v.businessDate}
                        <span aria-hidden> · </span>
                        Expected {formatMoney(v.expectedCash)} vs counted{" "}
                        {formatMoney(v.actualCash)}
                        <span aria-hidden> · </span>
                        {v.status.replace(/_/g, " ")}
                      </p>
                      {v.notes ? <p className="muted callover-batch-card__meta">{v.notes}</p> : null}
                    </div>
                    <div className="callover-variance-card__amount">
                      <span className="callover-batch-card__stat-label">Outstanding</span>
                      <strong
                        className={
                          v.varianceType === "shortage"
                            ? "callover-batch-card__stat--shortage"
                            : "callover-batch-card__stat--overage"
                        }
                      >
                        {formatMoney(v.outstandingAmount)}
                      </strong>
                    </div>
                  </div>
                  {!active ? (
                    <div className="callover-variance-card__actions">
                      <button
                        type="button"
                        className="button"
                        disabled={
                          busyId !== null || v.status === "settled" || v.status === "written_off"
                        }
                        onClick={() => openSettle("teller_till", v)}
                      >
                        {v.varianceType === "shortage" ? "Record repayment" : "Reconcile overage"}
                      </button>
                    </div>
                  ) : (
                    <div className="callover-variance-card__settle">
                      <label className="field">
                        <span>Amount (GHS)</span>
                        <input
                          type="number"
                          className="input-no-spin"
                          min="0.01"
                          step="0.01"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Method</span>
                        <select
                          value={method}
                          onChange={(e) =>
                            setMethod(e.target.value as CashVarianceSettlementMethod)
                          }
                        >
                          {v.varianceType === "shortage" ? (
                            <>
                              <option value="cash_repayment">Cash repayment</option>
                              <option value="salary_deduction">Salary deduction</option>
                              <option value="write_off">Write-off</option>
                              <option value="other">Other</option>
                            </>
                          ) : (
                            <>
                              <option value="other">Cash returned / reconciled</option>
                              <option value="write_off">Write-off</option>
                            </>
                          )}
                        </select>
                      </label>
                      <label className="field">
                        <span>Notes</span>
                        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
                      </label>
                      <div className="callover-variance-card__actions">
                        <button
                          type="button"
                          className="button"
                          disabled={busyId !== null}
                          onClick={() => void handleSettle()}
                        >
                          {busyId === v.id ? "Saving…" : "Save settlement"}
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busyId !== null}
                          onClick={closeAction}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
