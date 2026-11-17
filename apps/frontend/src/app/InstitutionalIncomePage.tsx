import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  INSTITUTIONAL_INCOME_SOURCE_LABELS,
  hasAnyPermission,
  type IncomeReportPeriod,
  type Permission
} from "@bms/shared";
import { useBranchesLiveSync } from "./hooks/useBranchesLiveSync";
import { useBranchesStore } from "./stores/branchesStore";
import { useInstitutionalIncomeStore } from "./stores/institutionalIncomeStore";
import { getActiveBranchFilter, getRuntimeBranchId, isAllBranchesScope } from "./api";

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS" }).format(value);
}

function formatShortDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    return isoDate;
  }
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const PERIOD_LABELS: Record<IncomeReportPeriod, string> = {
  daily: "Today",
  weekly: "This week",
  monthly: "This month",
  yearly: "This year"
};

const SOURCE_ACCENT: Record<string, string> = {
  susu_commission: "income-kpi--susu",
  savings_fee: "income-kpi--savings",
  current_fee: "income-kpi--current",
  meba_daakye_fee: "income-kpi--meba",
  other: "income-kpi--other"
};

function shortenNote(notes: string | null | undefined): string {
  if (!notes?.trim()) {
    return "Fee posting";
  }
  return notes
    .replace(/^Savings opening fee\s*/i, "")
    .replace(/^\(|\)$/g, "")
    .trim() || notes;
}

type Props = {
  permissions?: Permission[];
  susuOnly?: boolean;
  defaultBranchId?: string;
};

export function InstitutionalIncomePage({ permissions, susuOnly, defaultBranchId }: Props) {
  useBranchesLiveSync();
  const branches = useBranchesStore((s) => s.branches);
  const canFull = hasAnyPermission(permissions, ["income.read"]);

  const {
    report,
    period,
    branchId,
    loading,
    error,
    hydrate,
    setBranchId,
    setPeriod,
    startLiveSync,
    stopLiveSync,
    refresh
  } = useInstitutionalIncomeStore(
    useShallow((s) => ({
      report: s.report,
      period: s.period,
      branchId: s.branchId,
      loading: s.loading,
      error: s.error,
      hydrate: s.hydrate,
      setBranchId: s.setBranchId,
      setPeriod: s.setPeriod,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync,
      refresh: s.refresh
    }))
  );

  useEffect(() => {
    if (defaultBranchId) {
      setBranchId(defaultBranchId);
    } else if (isAllBranchesScope(getRuntimeBranchId())) {
      setBranchId(null);
    } else {
      setBranchId(getActiveBranchFilter() ?? getRuntimeBranchId() ?? null);
    }
  }, [defaultBranchId, setBranchId]);

  useEffect(() => {
    hydrate({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync]);

  const allowedPeriods =
    report?.allowedPeriods ??
    (canFull ? (["daily", "weekly", "monthly", "yearly"] as const) : (["daily"] as const));

  const title = susuOnly ? "Susu income" : "Institutional income";
  const subtitle = susuOnly
    ? "Fee income earned by your branches — cycle commissions and savings opening fees."
    : canFull
      ? "Company fee income by branch across Susu, savings, and current accounts."
      : "Today’s accumulated institutional income by branch.";

  const branchOptions = useMemo(() => {
    const tenantIds = new Set(
      branches.filter((b) => b.status !== "inactive").map((b) => String(b.id))
    );
    return branches.filter((b) => b.status !== "inactive" && tenantIds.has(String(b.id)));
  }, [branches]);

  const selectedBranch = useMemo(
    () => branchOptions.find((b) => String(b.id) === String(branchId ?? "")),
    [branchOptions, branchId]
  );

  const tenantBranchRows = useMemo(() => {
    if (!report) {
      return [];
    }
    const allowed = new Set(branchOptions.map((b) => String(b.id)));
    const rows =
      allowed.size === 0
        ? report.byBranch
        : report.byBranch
            .filter((row) => allowed.has(String(row.branchId)))
            .map((row) => {
              const match = branchOptions.find((b) => String(b.id) === String(row.branchId));
              return match ? { ...row, branchName: match.name, branchCode: match.code } : row;
            });
    return [...rows].sort((a, b) => b.amount - a.amount || a.branchName.localeCompare(b.branchName));
  }, [report, branchOptions]);

  const recentEntries = useMemo(() => {
    if (!report) {
      return [];
    }
    return report.recentEntries.filter((entry) =>
      branchOptions.length === 0
        ? true
        : branchOptions.some((b) => String(b.id) === String(entry.branchId))
    );
  }, [report, branchOptions]);

  const periodRange = report
    ? report.fromDate === report.toDate
      ? formatShortDate(report.fromDate)
      : `${formatShortDate(report.fromDate)} – ${formatShortDate(report.toDate)}`
    : null;

  const branchesWithIncome = tenantBranchRows.filter((r) => r.amount > 0 || r.entryCount > 0);

  return (
    <div className={`income-page${susuOnly ? " income-page--susu" : ""}`}>
      <header className="income-hero">
        <div className="income-hero__main">
          <p className="income-hero__eyebrow">{susuOnly ? "Susu management" : "Revenue"}</p>
          <h1>{title}</h1>
          <p className="income-hero__lede">{subtitle}</p>
          <div className="income-hero__meta">
            {selectedBranch ? (
              <span className="income-meta-pill">{selectedBranch.name}</span>
            ) : (
              <span className="income-meta-pill">All branches</span>
            )}
            {periodRange ? <span className="income-meta-pill income-meta-pill--quiet">{periodRange}</span> : null}
            {report ? (
              <span className="income-meta-pill income-meta-pill--quiet">
                {report.entryCount} posting{report.entryCount === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        </div>

        <div className="income-hero__total">
          <span className="income-hero__total-label">Period total</span>
          <strong className="income-hero__total-value">
            {report ? formatMoney(report.totalAmount) : loading ? "…" : formatMoney(0)}
          </strong>
          <button
            type="button"
            className="button secondary income-hero__refresh"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="income-controls">
        <label className="income-controls__branch">
          <span>Branch</span>
          <select
            value={branchId ?? ""}
            onChange={(e) => setBranchId(e.target.value || null)}
            disabled={loading}
          >
            <option value="">All branches</option>
            {branchOptions.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>

        <div className="income-period-seg" role="tablist" aria-label="Income period">
          {allowedPeriods.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={period === p}
              className={`income-period-seg__btn${period === p ? " is-active" : ""}`}
              disabled={loading || (!canFull && p !== "daily")}
              onClick={() => setPeriod(p)}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {!canFull ? (
          <p className="income-controls__note" role="status">
            Daily view only — ask an admin for full period access.
          </p>
        ) : null}
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading && !report ? <p className="muted income-loading">Loading income…</p> : null}

      {report ? (
        <>
          <section className="income-kpi-grid" aria-label="Income by source">
            {report.bySource.length === 0 ? (
              <article className="income-kpi income-kpi--empty">
                <span className="income-kpi__label">No fee income yet</span>
                <strong className="income-kpi__value">{formatMoney(0)}</strong>
                <span className="income-kpi__hint">
                  Totals appear when Susu cycle fees or savings opening fees are posted.
                </span>
              </article>
            ) : (
              report.bySource.map((row) => (
                <article
                  key={row.source}
                  className={`income-kpi ${SOURCE_ACCENT[row.source] ?? "income-kpi--other"}`}
                >
                  <span className="income-kpi__label">
                    {INSTITUTIONAL_INCOME_SOURCE_LABELS[row.source] ?? row.label}
                  </span>
                  <strong className="income-kpi__value">{formatMoney(row.amount)}</strong>
                  <span className="income-kpi__hint">
                    {row.entryCount} posting{row.entryCount === 1 ? "" : "s"}
                  </span>
                </article>
              ))
            )}
          </section>

          <div className="income-body">
            <section className="income-panel income-panel--branches" aria-labelledby="income-branches-heading">
              <header className="income-panel__head">
                <div>
                  <h2 id="income-branches-heading">Branches</h2>
                  <p className="muted">
                    {branchesWithIncome.length} of {tenantBranchRows.length} with income in this period
                  </p>
                </div>
              </header>

              {tenantBranchRows.length === 0 ? (
                <p className="income-empty muted">No branches for this company yet.</p>
              ) : (
                <ul className="income-branch-list">
                  {tenantBranchRows.map((row) => {
                    const code = branchOptions.find((b) => String(b.id) === String(row.branchId))?.code;
                    const share =
                      report.totalAmount > 0 ? Math.round((row.amount / report.totalAmount) * 100) : 0;
                    return (
                      <li key={row.branchId} className="income-branch-row">
                        <div className="income-branch-row__identity">
                          <strong>{row.branchName}</strong>
                          {code ? <span className="muted">{code}</span> : null}
                        </div>
                        <div className="income-branch-row__figures">
                          <span className="income-branch-row__period">{formatMoney(row.amount)}</span>
                          <span className="muted">
                            {row.entryCount} · bal {formatMoney(row.accountBalance)}
                          </span>
                        </div>
                        <div
                          className="income-branch-row__bar"
                          aria-hidden
                          title={`${share}% of period total`}
                        >
                          <span style={{ width: `${Math.min(100, Math.max(share, row.amount > 0 ? 4 : 0))}%` }} />
                        </div>
                        {row.bySource.length > 0 ? (
                          <div className="income-chips">
                            {row.bySource.map((s) => (
                              <span key={s.source} className="income-chip">
                                {INSTITUTIONAL_INCOME_SOURCE_LABELS[s.source] ?? s.label}
                                <em>{formatMoney(s.amount)}</em>
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="income-panel income-panel--ledger" aria-labelledby="income-ledger-heading">
              <header className="income-panel__head">
                <div>
                  <h2 id="income-ledger-heading">Postings</h2>
                  <p className="muted">Fee credits in this period</p>
                </div>
              </header>

              {recentEntries.length === 0 ? (
                <p className="income-empty muted">No postings in this period.</p>
              ) : (
                <ol className="income-ledger">
                  {recentEntries.map((entry) => {
                    const branchName =
                      tenantBranchRows.find((b) => b.branchId === entry.branchId)?.branchName ??
                      branchOptions.find((b) => String(b.id) === String(entry.branchId))?.name ??
                      "Branch";
                    const reversed = Boolean(entry.reversedAt);
                    const isReversal = Boolean(entry.reversesEntryId);
                    const status = isReversal ? "reversal" : reversed ? "reversed" : "posted";
                    return (
                      <li key={entry.id} className={`income-ledger__row income-ledger__row--${status}`}>
                        <div className="income-ledger__when">
                          <time dateTime={entry.businessDate}>{formatShortDate(entry.businessDate)}</time>
                          <span className="muted">{branchName}</span>
                        </div>
                        <div className="income-ledger__what">
                          <strong>
                            {INSTITUTIONAL_INCOME_SOURCE_LABELS[entry.source] ?? entry.source}
                          </strong>
                          <span className="muted">{shortenNote(entry.notes)}</span>
                        </div>
                        <div className="income-ledger__amt">
                          <strong>{formatMoney(entry.amount)}</strong>
                          <span className={`income-status income-status--${status}`}>
                            {isReversal ? "Reversal" : reversed ? "Reversed" : "Posted"}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
