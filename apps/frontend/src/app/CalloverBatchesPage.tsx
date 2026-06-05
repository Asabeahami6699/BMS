import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppRole, Branch, Customer, PendingCollectionBatch } from "./api";
import {
  getAuthMe,
  listBranches,
  listCustomers,
  listFieldAgents,
  listPendingCollectionBatches,
  postAllCollectionBatches,
  postCollectionBatch
} from "./api";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";

type Props = { role: AppRole };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

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

export function CalloverBatchesPage({ role }: Props) {
  const { showToast } = useToast();
  const [businessDate, setBusinessDate] = useState(todayIso());
  const [branchId, setBranchId] = useState("");
  const [branchLocked, setBranchLocked] = useState(false);
  const [fieldAgentId, setFieldAgentId] = useState("");
  const [batches, setBatches] = useState<PendingCollectionBatch[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [agents, setAgents] = useState<
    { userId: string; fullName: string; email: string; branchId?: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);

  const branchLabel = useCallback(
    (id?: string) => {
      if (!id) {
        return "Unassigned branch";
      }
      const branch = branchById.get(id);
      return branch ? `${branch.name} (${branch.code})` : id.slice(0, 8) + "…";
    },
    [branchById]
  );

  const visibleAgents = useMemo(() => {
    if (!branchId) {
      return agents;
    }
    return agents.filter((a) => a.branchId === branchId);
  }, [agents, branchId]);

  useEffect(() => {
    void getAuthMe()
      .then((me) => {
        if (me.scopeType === "branch" && me.branchId) {
          setBranchId(me.branchId);
          setBranchLocked(true);
        }
      })
      .catch(() => undefined);
  }, []);

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [batchRows, customerRows, agentRows, branchRows] = await Promise.all([
        listPendingCollectionBatches({
          businessDate,
          fieldAgentId: fieldAgentId || undefined,
          branchId: branchId || undefined
        }),
        listCustomers(),
        listFieldAgents(),
        listBranches()
      ]);
      setBatches(batchRows);
      setCustomers(customerRows);
      setBranches(branchRows.filter((b) => b.status !== "inactive"));
      setAgents(
        agentRows.map((a) => ({
          userId: a.userId,
          fullName: a.fullName ?? a.email,
          email: a.email,
          branchId: a.branchId
        }))
      );
      setExpandedId((prev) => {
        if (prev && batchRows.some((b) => b.id === prev)) {
          return prev;
        }
        return batchRows[0]?.id ?? null;
      });
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to load callover batches"), "error");
    } finally {
      setLoading(false);
    }
  }, [businessDate, branchId, fieldAgentId, showToast]);

  useEffect(() => {
    if (!fieldAgentId) {
      return;
    }
    const stillVisible = visibleAgents.some((a) => a.userId === fieldAgentId);
    if (!stillVisible) {
      setFieldAgentId("");
    }
  }, [fieldAgentId, visibleAgents]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () => ({
      batches: batches.length,
      amount: batches.reduce((sum, b) => sum + b.totalAmount, 0),
      lines: batches.reduce((sum, b) => sum + b.lineCount, 0),
      ready: batches.filter((b) => batchTotalsMatch(b)).length
    }),
    [batches]
  );

  const allReady = batches.length > 0 && totals.ready === batches.length;

  async function handlePostBatch(batchId: string) {
    setBusyId(batchId);
    try {
      await postCollectionBatch(batchId);
      showToast("Batch posted — customer accounts credited", "success");
      await load();
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to post batch"), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handlePostAll() {
    if (batches.length === 0) {
      showToast("No pending batches to post", "info");
      return;
    }
    if (!allReady) {
      showToast("Fix mismatched batches before posting all", "error");
      return;
    }
    setBusyId("all");
    try {
      const result = await postAllCollectionBatches({
        businessDate,
        fieldAgentId: fieldAgentId || undefined,
        branchId: branchId || undefined
      });
      showToast(`Posted ${result.posted} batch${result.posted === 1 ? "" : "es"}`, "success");
      await load();
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to post batches"), "error");
    } finally {
      setBusyId(null);
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
            Review agent call-over totals, confirm line amounts, then post to credit customer accounts and the ledger.
          </p>
        </div>
        <div className="callover-batches-hero__actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => void load()}
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
          <p className="kpi-meta muted">Totals match line sums</p>
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
                          className={`callover-batch-card__badge${totalsMatch ? " callover-batch-card__badge--ready" : " callover-batch-card__badge--warn"}`}
                        >
                          {totalsMatch ? "Ready to post" : "Totals mismatch"}
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
                      disabled={busyId !== null || !totalsMatch}
                      onClick={() => void handlePostBatch(batch.id)}
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
                    <span className="callover-batch-card__stat-label">Variance</span>
                    <strong className={totalsMatch ? "callover-batch-card__stat--ok" : "callover-batch-card__stat--bad"}>
                      {totalsMatch
                        ? "Balanced"
                        : formatMoney(Math.abs(lineTotals - batch.totalAmount))}
                    </strong>
                  </div>
                </div>

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
    </div>
  );
}
