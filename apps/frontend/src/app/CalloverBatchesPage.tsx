import { formatAccountAmount } from "@bms/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  AppRole,
  CashVarianceCase,
  CashVarianceSettlementMethod,
  PendingCollectionBatch
} from "./api";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { usePageLoading } from "./hooks/usePageLoading";
import { formatBranchLabel } from "./branchDisplay";
import { useCalloverBatchesStore } from "./stores/calloverBatchesStore";

type Props = { role: AppRole };

function formatMoney(amount: number): string {
  return `GHS ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function agentInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatSubmittedAt(iso?: string): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function batchLineSum(batch: PendingCollectionBatch): number {
  return batch.lines.reduce((sum, line) => sum + line.amount, 0);
}

function batchTotalsMatch(batch: PendingCollectionBatch): boolean {
  return Math.abs(batchLineSum(batch) - batch.totalAmount) < 0.01;
}

function cashFlag(batchTotal: number, cashText: string): {
  amount: number | null;
  label: string;
  tone: "ok" | "warn" | "bad" | "muted";
} {
  const trimmed = cashText.trim();
  if (!trimmed) {
    return { amount: null, label: "Enter cash brought", tone: "muted" };
  }
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) {
    return { amount: null, label: "Invalid amount", tone: "bad" };
  }
  const variance = Math.round((amount - batchTotal) * 100) / 100;
  if (Math.abs(variance) < 0.005) {
    return { amount, label: "Balanced", tone: "ok" };
  }
  if (variance < 0) {
    return { amount, label: `Shortage ${formatMoney(Math.abs(variance))}`, tone: "bad" };
  }
  return { amount, label: `Overage ${formatMoney(variance)}`, tone: "warn" };
}

export function CalloverBatchesPage({ role }: Props) {
  const { showToast } = useToast();
  const businessDate = useCalloverBatchesStore((s) => s.businessDate);
  const branchId = useCalloverBatchesStore((s) => s.branchId);
  const branchLocked = useCalloverBatchesStore((s) => s.branchLocked);
  const fieldAgentId = useCalloverBatchesStore((s) => s.fieldAgentId);
  const batches = useCalloverBatchesStore((s) => s.batches);
  const customers = useCalloverBatchesStore((s) => s.customers);
  const branches = useCalloverBatchesStore((s) => s.branches);
  const agents = useCalloverBatchesStore((s) => s.agents);
  const variances = useCalloverBatchesStore((s) => s.variances);
  const loading = useCalloverBatchesStore((s) => s.loading);
  const busyId = useCalloverBatchesStore((s) => s.busyId);
  const error = useCalloverBatchesStore((s) => s.error);
  const hydrate = useCalloverBatchesStore((s) => s.hydrate);
  const refresh = useCalloverBatchesStore((s) => s.refresh);
  const startLiveSync = useCalloverBatchesStore((s) => s.startLiveSync);
  const stopLiveSync = useCalloverBatchesStore((s) => s.stopLiveSync);
  const initScope = useCalloverBatchesStore((s) => s.initScope);
  const setBusinessDate = useCalloverBatchesStore((s) => s.setBusinessDate);
  const setBranchId = useCalloverBatchesStore((s) => s.setBranchId);
  const setFieldAgentId = useCalloverBatchesStore((s) => s.setFieldAgentId);
  const postBatch = useCalloverBatchesStore((s) => s.postBatch);
  const postAll = useCalloverBatchesStore((s) => s.postAll);
  const settleVariance = useCalloverBatchesStore((s) => s.settleVariance);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cashByBatchId, setCashByBatchId] = useState<Record<string, string>>({});
  const [settleId, setSettleId] = useState<string | null>(null);
  const [settleAmount, setSettleAmount] = useState("");
  const [settleMethod, setSettleMethod] = useState<CashVarianceSettlementMethod>("cash_repayment");
  const [settleNotes, setSettleNotes] = useState("");

  usePageLoading(loading || busyId !== null, "callover-batches");

  const branchLabel = useCallback(
    (id?: string) => {
      if (!id) {
        return "Unassigned branch";
      }
      return formatBranchLabel(id, branches);
    },
    [branches]
  );

  const visibleAgents = useMemo(() => {
    if (!branchId) {
      return agents;
    }
    return agents.filter((a) => a.branchId === branchId);
  }, [agents, branchId]);

  useEffect(() => {
    void (async () => {
      await initScope();
      hydrate({ force: true });
      startLiveSync();
    })();
    return () => stopLiveSync();
  }, [hydrate, initScope, startLiveSync, stopLiveSync]);

  useEffect(() => {
    if (error) {
      showToast(error, "error");
    }
  }, [error, showToast]);

  useEffect(() => {
    setExpandedId((prev) => {
      if (prev && batches.some((b) => b.id === prev)) {
        return prev;
      }
      return batches[0]?.id ?? null;
    });
  }, [batches]);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const customerLabel = useCallback(
    (customerId: string) => {
      const customer = customerById.get(customerId);
      if (!customer) {
        return { name: customerId.slice(0, 8) + "…", sub: undefined };
      }
      return {
        name: customer.fullName,
        sub: customer.accountNumber ?? customer.phone
      };
    },
    [customerById]
  );

  useEffect(() => {
    if (!fieldAgentId) {
      return;
    }
    const stillVisible = visibleAgents.some((a) => a.userId === fieldAgentId);
    if (!stillVisible) {
      setFieldAgentId("");
    }
  }, [fieldAgentId, setFieldAgentId, visibleAgents]);

  const totals = useMemo(
    () => ({
      batches: batches.length,
      amount: batches.reduce((sum, b) => sum + b.totalAmount, 0),
      lines: batches.reduce((sum, b) => sum + b.lineCount, 0),
      ready: batches.filter((b) => batchTotalsMatch(b)).length
    }),
    [batches]
  );

  const allLineReady = batches.length > 0 && totals.ready === batches.length;
  const allCashReady = batches.every((b) => cashFlag(b.totalAmount, cashByBatchId[b.id] ?? "").amount != null);
  const allReady = allLineReady && allCashReady;

  const postingRef = useRef(false);

  async function handlePostBatch(batch: PendingCollectionBatch) {
    if (postingRef.current) {
      return;
    }
    const cash = cashFlag(batch.totalAmount, cashByBatchId[batch.id] ?? "");
    if (cash.amount == null) {
      showToast("Enter the cash amount the mobilizer brought before posting", "error");
      return;
    }
    postingRef.current = true;
    try {
      const posted = await postBatch(batch.id, cash.amount);
      const flag =
        posted.cashVarianceStatus === "balanced"
          ? "Balanced"
          : posted.cashVarianceStatus === "shortage"
            ? `Shortage ${formatMoney(Math.abs(posted.cashVariance ?? 0))}`
            : posted.cashVarianceStatus === "overage"
              ? `Overage ${formatMoney(posted.cashVariance ?? 0)}`
              : "Posted";
      showToast(`Batch posted · ${flag}`, "success");
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to post batch"), "error");
    } finally {
      postingRef.current = false;
    }
  }

  function openSettle(v: CashVarianceCase) {
    setSettleId(v.id);
    setSettleAmount(v.outstandingAmount.toFixed(2));
    setSettleMethod(v.varianceType === "shortage" ? "cash_repayment" : "customer_correction");
    setSettleNotes("");
  }

  async function handleSettle() {
    if (!settleId) {
      return;
    }
    const amount = Number(settleAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Enter a valid settlement amount", "error");
      return;
    }
    try {
      const updated = await settleVariance(settleId, {
        amount,
        method: settleMethod,
        notes: settleNotes.trim() || undefined
      });
      showToast(
        updated.status === "settled" || updated.status === "written_off"
          ? "Variance closed"
          : `Partial settlement recorded · outstanding ${formatMoney(updated.outstandingAmount)}`,
        "success"
      );
      setSettleId(null);
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to settle variance"), "error");
    }
  }

  async function handlePostAll() {
    if (batches.length === 0) {
      showToast("No pending batches to post", "info");
      return;
    }
    if (!allLineReady) {
      showToast("Fix mismatched batches before posting all", "error");
      return;
    }
    if (!allCashReady) {
      showToast("Enter cash brought for every batch before posting all", "error");
      return;
    }
    if (postingRef.current) {
      return;
    }
    postingRef.current = true;
    try {
      const cashMap: Record<string, number> = {};
      for (const batch of batches) {
        const cash = cashFlag(batch.totalAmount, cashByBatchId[batch.id] ?? "");
        if (cash.amount == null) {
          throw new Error("Missing cash amount");
        }
        cashMap[batch.id] = cash.amount;
      }
      const result = await postAll(cashMap);
      showToast(`Posted ${result.posted} batch${result.posted === 1 ? "" : "es"}`, "success");
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to post batches"), "error");
    } finally {
      postingRef.current = false;
    }
  }

  if (role !== "admin" && role !== "coordinator") {
    return (
      <article className="card">
        <h2>Access restricted</h2>
        <p className="muted">Only coordinators can review and post collection batches.</p>
      </article>
    );
  }

  return (
    <div className="callover-batches-page">
      <header className="callover-batches-hero">
        <div className="callover-batches-hero__copy">
          <p className="callover-batches-hero__eyebrow">Susu · Field collections</p>
          <h1>Callover batches</h1>
          <p className="muted">
            Enter the cash each mobilizer brought, compare it to the call-over total, then post to credit customer
            accounts. Shortages and overages stay open separately — never offset against each other.
          </p>
        </div>
        <div className="callover-batches-hero__actions">
          <Link to="/app/susu/overages-shortages" className="button secondary">
            Overages/Shortages
          </Link>
          <button
            type="button"
            className="button secondary"
            onClick={() => void refresh()}
            disabled={loading || busyId !== null}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          {batches.length > 0 ? (
            <button
              type="button"
              className="button"
              disabled={busyId !== null || !allReady}
              onClick={() => void handlePostAll()}
              title={allReady ? undefined : "All batches must balance before posting all"}
            >
              {busyId === "all"
                ? "Posting…"
                : fieldAgentId
                  ? "Post agent batch"
                  : branchId
                    ? "Post all branch batches"
                    : "Post all batches"}
            </button>
          ) : null}
        </div>
      </header>

      <div className="kpi-grid callover-batches-kpis">
        <article className="kpi-card kpi-card--primary">
          <div className="kpi-card-head">
            <div>
              <p className="kpi-label">Pending batches</p>
              <p className="kpi-value">{loading ? "—" : totals.batches}</p>
            </div>
            <span className="kpi-icon" aria-hidden>
              ◷
            </span>
          </div>
          <p className="kpi-meta muted">Awaiting coordinator post</p>
        </article>
        <article className="kpi-card kpi-card--success">
          <div className="kpi-card-head">
            <div>
              <p className="kpi-label">Total cash</p>
              <p className="kpi-value">{loading ? "—" : formatMoney(totals.amount)}</p>
            </div>
            <span className="kpi-icon" aria-hidden>
              ₵
            </span>
          </div>
          <p className="kpi-meta muted">Across pending batches</p>
        </article>
        <article className="kpi-card kpi-card--purple">
          <div className="kpi-card-head">
            <div>
              <p className="kpi-label">Collection lines</p>
              <p className="kpi-value">{loading ? "—" : totals.lines}</p>
            </div>
            <span className="kpi-icon" aria-hidden>
              ☰
            </span>
          </div>
          <p className="kpi-meta muted">Customer contributions</p>
        </article>
        <article className={`kpi-card ${allReady && totals.batches > 0 ? "kpi-card--success" : "kpi-card--warning"}`}>
          <div className="kpi-card-head">
            <div>
              <p className="kpi-label">Ready to post</p>
              <p className="kpi-value">
                {loading ? "—" : `${totals.ready}/${totals.batches || 0}`}
              </p>
            </div>
            <span className="kpi-icon" aria-hidden>
              ✓
            </span>
          </div>
          <p className="kpi-meta muted">Lines match + cash entered</p>
        </article>
      </div>

      <article className="card callover-batches-filters">
        <div className="callover-batches-filters__grid">
          <label className="field">
            <span>Business date</span>
            <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Branch</span>
            <select
              value={branchId}
              disabled={branchLocked}
              onChange={(e) => setBranchId(e.target.value)}
            >
              {!branchLocked ? <option value="">All branches</option> : null}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Field agent</span>
            <select value={fieldAgentId} onChange={(e) => setFieldAgentId(e.target.value)}>
              <option value="">All agents{branchId ? " in branch" : ""}</option>
              {visibleAgents.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.fullName} · {a.email}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="callover-batches-filters__hint muted">
          Showing batches for{" "}
          <strong>{new Date(businessDate + "T12:00:00").toLocaleDateString(undefined, { dateStyle: "medium" })}</strong>
          {branchId ? (
            <>
              {" "}
              · <strong>{branchLabel(branchId)}</strong>
            </>
          ) : (
            " · all branches"
          )}
          {fieldAgentId ? (
            <>
              {" "}
              ·{" "}
              <strong>{agents.find((a) => a.userId === fieldAgentId)?.fullName ?? "Selected agent"}</strong>
            </>
          ) : (
            " · all field agents"
          )}
        </p>
      </article>

      {loading ? (
        <div className="callover-batches-list" aria-busy="true">
          {[0, 1].map((i) => (
            <article key={i} className="callover-batch-card callover-batch-card--skeleton">
              <div className="callover-batch-card__head">
                <span className="callover-batch-card__avatar skeleton-block" />
                <div className="callover-batch-card__identity">
                  <span className="skeleton-line skeleton-line--lg" />
                  <span className="skeleton-line skeleton-line--sm" />
                </div>
              </div>
              <div className="callover-batch-card__stats">
                <span className="skeleton-block" />
                <span className="skeleton-block" />
                <span className="skeleton-block" />
              </div>
            </article>
          ))}
        </div>
      ) : batches.length === 0 ? (
        <article className="callover-batches-empty card">
          <span className="callover-batches-empty__icon" aria-hidden>
            ✓
          </span>
          <h2>Nothing pending</h2>
          <p className="muted">
            No collection batches are waiting for approval
            {branchId ? " for this branch" : ""}
            {fieldAgentId ? " from this agent" : ""} on this date. Agents appear here after they send call-over for
            approval.
          </p>
        </article>
      ) : (
        <div className="callover-batches-list">
          {batches.map((batch) => {
            const expanded = expandedId === batch.id;
            const lineTotals = batchLineSum(batch);
            const totalsMatch = batchTotalsMatch(batch);
            const cash = cashFlag(batch.totalAmount, cashByBatchId[batch.id] ?? "");
            const canPost = totalsMatch && cash.amount != null;
            return (
              <article
                key={batch.id}
                className={`callover-batch-card${expanded ? " callover-batch-card--expanded" : ""}${totalsMatch ? "" : " callover-batch-card--warn"}`}
              >
                <div className="callover-batch-card__head">
                  <div className="callover-batch-card__agent">
                    <span className="callover-batch-card__avatar" aria-hidden>
                      {agentInitials(batch.fieldAgentName)}
                    </span>
                    <div className="callover-batch-card__identity">
                      <div className="callover-batch-card__title-row">
                        <h2>{batch.fieldAgentName}</h2>
                        <span
                          className={`callover-batch-card__badge${
                            !totalsMatch || cash.tone === "muted"
                              ? " callover-batch-card__badge--warn"
                              : cash.tone === "ok"
                                ? " callover-batch-card__badge--ready"
                                : cash.tone === "bad"
                                  ? " callover-batch-card__badge--shortage"
                                  : " callover-batch-card__badge--overage"
                          }`}
                        >
                          {canPost
                            ? cash.label
                            : !totalsMatch
                              ? "Totals mismatch"
                              : "Enter cash brought"}
                        </span>
                      </div>
                      <p className="muted callover-batch-card__meta">
                        {batch.fieldAgentEmail ?? batch.fieldAgentId.slice(0, 8)}
                        <span aria-hidden> · </span>
                        {branchLabel(batch.branchId)}
                        <span aria-hidden> · </span>
                        Submitted {formatSubmittedAt(batch.submittedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="callover-batch-card__actions">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setExpandedId(expanded ? null : batch.id)}
                      aria-expanded={expanded}
                    >
                      {expanded ? "Hide lines" : `View ${batch.lineCount} lines`}
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={busyId !== null || !canPost}
                      onClick={() => void handlePostBatch(batch)}
                    >
                      {busyId === batch.id ? "Posting…" : "Post batch"}
                    </button>
                  </div>
                </div>

                <div className="callover-batch-card__stats">
                  <div className="callover-batch-card__stat">
                    <span className="callover-batch-card__stat-label">Batch total</span>
                    <strong>{formatMoney(batch.totalAmount)}</strong>
                  </div>
                  <div className="callover-batch-card__stat">
                    <span className="callover-batch-card__stat-label">Line sum</span>
                    <strong className={totalsMatch ? undefined : "callover-batch-card__stat--bad"}>
                      {formatMoney(lineTotals)}
                    </strong>
                  </div>
                  <div className="callover-batch-card__stat">
                    <span className="callover-batch-card__stat-label">Customers</span>
                    <strong>{batch.lineCount}</strong>
                  </div>
                  <div className="callover-batch-card__stat">
                    <span className="callover-batch-card__stat-label">Cash vs batch</span>
                    <strong
                      className={
                        cash.tone === "ok"
                          ? "callover-batch-card__stat--ok"
                          : cash.tone === "bad"
                            ? "callover-batch-card__stat--shortage"
                            : cash.tone === "warn"
                              ? "callover-batch-card__stat--overage"
                              : undefined
                      }
                    >
                      {cash.label}
                    </strong>
                  </div>
                </div>

                <label className="field callover-batch-card__cash">
                  <span>Cash brought to office (GHS)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder={formatAccountAmount(batch.totalAmount)}
                    value={cashByBatchId[batch.id] ?? ""}
                    onChange={(e) =>
                      setCashByBatchId((prev) => ({ ...prev, [batch.id]: e.target.value }))
                    }
                  />
                </label>

                {!totalsMatch ? (
                  <p className="callover-batch-card__alert">
                    Line amounts do not match the batch total. Review collections before posting.
                  </p>
                ) : null}

                {batch.agentNotes ? (
                  <blockquote className="callover-batch-card__notes">
                    <span className="callover-batch-card__notes-label">Agent notes</span>
                    {batch.agentNotes}
                  </blockquote>
                ) : null}

                {expanded ? (
                  <div className="callover-batch-card__lines">
                    <div className="callover-batch-card__lines-head">
                      <h3>Collection lines</h3>
                      <span className="muted">{batch.lines.length} entries</span>
                    </div>
                    <ul className="callover-batch-card__line-list">
                      {batch.lines.map((line) => {
                        const customer = customerLabel(line.customerId);
                        return (
                          <li key={line.id} className="callover-batch-card__line">
                            <div className="callover-batch-card__line-main">
                              <strong>{customer.name}</strong>
                              {customer.sub ? <span className="muted">{customer.sub}</span> : null}
                            </div>
                            <div className="callover-batch-card__line-side">
                              <strong>{formatMoney(line.amount)}</strong>
                              {line.notes ? <span className="muted callover-batch-card__line-note">{line.notes}</span> : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <section className="callover-variance-section">
        <div className="callover-variance-section__head">
          <div className="callover-variance-section__title-row">
            <h2>Open cash variances</h2>
            <Link to="/app/susu/overages-shortages" className="button secondary">
              Open Overages/Shortages
            </Link>
          </div>
          <p className="muted">
            Shortages are agent debt (pay office). Overages need missing collection entries reconciled. They are never
            netted against each other. Use Overages/Shortages to filter by agent/date and credit customers from overages.
          </p>
        </div>
        {variances.length === 0 ? (
          <article className="card callover-batches-empty">
            <p className="muted">No open shortages or overages for this filter.</p>
          </article>
        ) : (
          <div className="callover-variance-list">
            {variances.map((v) => {
              const settling = settleId === v.id;
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

                  {!settling ? (
                    <div className="callover-variance-card__actions">
                      <button
                        type="button"
                        className="button"
                        disabled={busyId !== null}
                        onClick={() => openSettle(v)}
                      >
                        {v.varianceType === "shortage" ? "Record repayment" : "Record reconciliation"}
                      </button>
                    </div>
                  ) : (
                    <div className="callover-variance-card__settle">
                      <label className="field">
                        <span>Amount (GHS)</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={settleAmount}
                          onChange={(e) => setSettleAmount(e.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Method</span>
                        <select
                          value={settleMethod}
                          onChange={(e) =>
                            setSettleMethod(e.target.value as CashVarianceSettlementMethod)
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
                        <input
                          value={settleNotes}
                          onChange={(e) => setSettleNotes(e.target.value)}
                          placeholder={
                            v.varianceType === "shortage"
                              ? "e.g. Paid at office"
                              : "e.g. Credited missing customer X"
                          }
                        />
                      </label>
                      <div className="callover-variance-card__actions">
                        <button
                          type="button"
                          className="button"
                          disabled={busyId !== null}
                          onClick={() => void handleSettle()}
                        >
                          {busyId === `settle:${v.id}` ? "Saving…" : "Save settlement"}
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busyId !== null}
                          onClick={() => setSettleId(null)}
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
