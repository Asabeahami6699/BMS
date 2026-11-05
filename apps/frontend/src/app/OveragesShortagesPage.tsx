import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  AppRole,
  CashVarianceCase,
  CashVarianceSettlementMethod,
  CashVarianceType,
  Customer
} from "./api";
import {
  creditCustomerFromOverage,
  getAuthMe,
  listCashVariances,
  listCustomers,
  listFieldAgents,
  settleCashVariance
} from "./api";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { usePageLoading } from "./hooks/usePageLoading";

type Props = { role: AppRole };

function formatMoney(amount: number): string {
  return `GHS ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function OveragesShortagesPage({ role }: Props) {
  const { showToast } = useToast();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [fieldAgentId, setFieldAgentId] = useState("");
  const [varianceType, setVarianceType] = useState<"" | CashVarianceType>("");
  const [status, setStatus] = useState<"open" | "all">("open");
  const [cases, setCases] = useState<CashVarianceCase[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [agents, setAgents] = useState<{ userId: string; fullName: string; email: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<"settle" | "credit" | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<CashVarianceSettlementMethod>("cash_repayment");
  const [notes, setNotes] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");

  usePageLoading(loading || busyId !== null, "overages-shortages");

  useEffect(() => {
    void getAuthMe().catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, agentRows, customerRows] = await Promise.all([
        listCashVariances({
          status,
          fieldAgentId: fieldAgentId || undefined,
          varianceType: varianceType || undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined
        }),
        listFieldAgents(),
        listCustomers()
      ]);
      setCases(rows);
      setAgents(
        agentRows.map((a) => ({
          userId: a.userId,
          fullName: a.fullName ?? a.email,
          email: a.email
        }))
      );
      setCustomers(customerRows.filter((c) => c.status === "active"));
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to load overages & shortages"), "error");
    } finally {
      setLoading(false);
    }
  }, [status, fieldAgentId, varianceType, fromDate, toDate, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const shortages = cases.filter((c) => c.varianceType === "shortage");
    const overages = cases.filter((c) => c.varianceType === "overage");
    return {
      shortageOutstanding: shortages.reduce((s, c) => s + c.outstandingAmount, 0),
      overageOutstanding: overages.reduce((s, c) => s + c.outstandingAmount, 0),
      shortageCount: shortages.length,
      overageCount: overages.length
    };
  }, [cases]);

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

  function openSettle(v: CashVarianceCase) {
    setActionId(v.id);
    setActionMode("settle");
    setAmount(v.outstandingAmount.toFixed(2));
    setMethod(v.varianceType === "shortage" ? "cash_repayment" : "customer_correction");
    setNotes("");
    setCustomerId("");
    setCustomerQuery("");
  }

  function openCredit(v: CashVarianceCase) {
    setActionId(v.id);
    setActionMode("credit");
    setAmount(v.outstandingAmount.toFixed(2));
    setNotes("");
    setCustomerId("");
    setCustomerQuery("");
  }

  function closeAction() {
    setActionId(null);
    setActionMode(null);
  }

  async function handleSettle() {
    if (!actionId) {
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    setBusyId(actionId);
    try {
      const updated = await settleCashVariance(actionId, {
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
      await load();
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to settle"), "error");
    } finally {
      setBusyId(null);
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
    setBusyId(actionId);
    try {
      await creditCustomerFromOverage(actionId, {
        customerId,
        amount: value,
        notes: notes.trim() || undefined
      });
      showToast("Customer credited · Settled shortage posted to ledger", "success");
      closeAction();
      await load();
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to credit customer"), "error");
    } finally {
      setBusyId(null);
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
            Filter agent balances by date. Shortages are agent debt. Overages can credit a customer who was
            under-posted — never offset against each other.
          </p>
        </div>
        <div className="callover-batches-hero__actions">
          <Link to="/app/susu/callover-batches" className="button secondary">
            Callover batches
          </Link>
          <button
            type="button"
            className="button secondary"
            onClick={() => void load()}
            disabled={loading || busyId !== null}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="kpi-grid callover-batches-kpis">
        <article className="kpi-card kpi-card--warning">
          <div className="kpi-card-head">
            <div>
              <p className="kpi-label">Open shortages</p>
              <p className="kpi-value">{loading ? "—" : formatMoney(totals.shortageOutstanding)}</p>
            </div>
          </div>
          <p className="kpi-meta muted">{totals.shortageCount} case(s) · agent owes office</p>
        </article>
        <article className="kpi-card kpi-card--primary">
          <div className="kpi-card-head">
            <div>
              <p className="kpi-label">Open overages</p>
              <p className="kpi-value">{loading ? "—" : formatMoney(totals.overageOutstanding)}</p>
            </div>
          </div>
          <p className="kpi-meta muted">{totals.overageCount} case(s) · to reconcile</p>
        </article>
      </div>

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

      {cases.length === 0 ? (
        <article className="card callover-batches-empty">
          <p className="muted">{loading ? "Loading…" : "No variances match these filters."}</p>
        </article>
      ) : (
        <div className="callover-variance-list">
          {cases.map((v) => {
            const active = actionId === v.id;
            return (
              <article
                key={v.id}
                className={`card callover-variance-card callover-variance-card--${v.varianceType}`}
              >
                <div className="callover-variance-card__head">
                  <div>
                    <div className="callover-variance-card__title-row">
                      <h3>{v.fieldAgentName ?? v.fieldAgentId.slice(0, 8)}</h3>
                      <span className={`callover-batch-card__badge callover-batch-card__badge--${v.varianceType}`}>
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
                        disabled={busyId !== null || v.status === "settled" || v.status === "written_off"}
                        onClick={() => openSettle(v)}
                      >
                        Record repayment
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="button"
                          disabled={busyId !== null || v.status === "settled" || v.status === "written_off"}
                          onClick={() => openCredit(v)}
                        >
                          Credit customer (settled shortage)
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busyId !== null || v.status === "settled" || v.status === "written_off"}
                          onClick={() => openSettle(v)}
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
                        onChange={(e) => setMethod(e.target.value as CashVarianceSettlementMethod)}
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
    </div>
  );
}
