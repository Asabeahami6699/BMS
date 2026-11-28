import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  INSTITUTIONAL_INCOME_SOURCE_LABELS,
  hasAnyPermission,
  type IncomeReportPeriod,
  type InstitutionalIncomeCapitalTransfer,
  type Permission
} from "@bms/shared";
import {
  AccountingAmountInput,
  formatAccountingInput,
  parseAccountingAmount
} from "../components/AccountingAmountInput";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useBranchesLiveSync } from "./hooks/useBranchesLiveSync";
import { useBranchesStore } from "./stores/branchesStore";
import { useInstitutionalIncomeStore } from "./stores/institutionalIncomeStore";
import {
  getActiveBranchFilter,
  getRuntimeBranchId,
  isAllBranchesScope,
  type AppRole
} from "./api";

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

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `inc-cap-${crypto.randomUUID()}`;
  }
  return `inc-cap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  return (
    notes
      .replace(/^Savings opening fee\s*/i, "")
      .replace(/^\(|\)$/g, "")
      .trim() || notes
  );
}

type Props = {
  role?: AppRole;
  permissions?: Permission[];
  susuOnly?: boolean;
  defaultBranchId?: string;
};

export function InstitutionalIncomePage({ role, permissions, susuOnly, defaultBranchId }: Props) {
  const { showToast } = useToast();
  useBranchesLiveSync();
  const branches = useBranchesStore((s) => s.branches);
  const canFull = hasAnyPermission(permissions, ["income.read"]);
  const canTransferToCapital = canFull && (role === "admin" || role === "accountant");

  const {
    report,
    period,
    branchId,
    loading,
    transferring,
    reversingTransferId,
    error,
    hydrate,
    setBranchId,
    setPeriod,
    transferToCapital,
    reverseTransfer,
    startLiveSync,
    stopLiveSync,
    refresh
  } = useInstitutionalIncomeStore(
    useShallow((s) => ({
      report: s.report,
      period: s.period,
      branchId: s.branchId,
      loading: s.loading,
      transferring: s.transferring,
      reversingTransferId: s.reversingTransferId,
      error: s.error,
      hydrate: s.hydrate,
      setBranchId: s.setBranchId,
      setPeriod: s.setPeriod,
      transferToCapital: s.transferToCapital,
      reverseTransfer: s.reverseTransfer,
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

  const [postingSearch, setPostingSearch] = useState("");
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferBranchId, setTransferBranchId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferDate, setTransferDate] = useState(todayIsoDate);
  const [transferReference, setTransferReference] = useState("");
  const [transferNotes, setTransferNotes] = useState("");
  const [transferIdempotencyKey, setTransferIdempotencyKey] = useState("");

  const [reverseTarget, setReverseTarget] = useState<InstitutionalIncomeCapitalTransfer | null>(
    null
  );
  const [reverseReason, setReverseReason] = useState("");

  const transferBranchCandidates = useMemo(() => {
    return tenantBranchRows.map((row) => ({
      branchId: row.branchId,
      branchName: row.branchName,
      availableBalance: row.accountBalance
    }));
  }, [tenantBranchRows]);

  const selectedTransferBranch = useMemo(
    () =>
      transferBranchCandidates.find((b) => String(b.branchId) === String(transferBranchId)) ??
      null,
    [transferBranchCandidates, transferBranchId]
  );

  const parsedTransferAmount = useMemo(() => {
    if (!transferAmount.trim()) {
      return Number.NaN;
    }
    return parseAccountingAmount(transferAmount);
  }, [transferAmount]);

  const transferExceedsAvailable =
    selectedTransferBranch != null &&
    Number.isFinite(parsedTransferAmount) &&
    parsedTransferAmount > selectedTransferBranch.availableBalance + 0.0001;

  const remainingAfterTransfer =
    selectedTransferBranch != null && Number.isFinite(parsedTransferAmount) && parsedTransferAmount > 0
      ? Math.max(
          0,
          Math.round((selectedTransferBranch.availableBalance - parsedTransferAmount) * 100) / 100
        )
      : selectedTransferBranch?.availableBalance ?? 0;

  function openTransferModal(preferredBranchId?: string) {
    const candidate =
      (preferredBranchId
        ? transferBranchCandidates.find((b) => String(b.branchId) === String(preferredBranchId))
        : null) ??
      (branchId
        ? transferBranchCandidates.find((b) => String(b.branchId) === String(branchId))
        : null) ??
      transferBranchCandidates.find((b) => b.availableBalance > 0) ??
      transferBranchCandidates[0] ??
      null;

    setTransferBranchId(candidate?.branchId ?? "");
    setTransferAmount("");
    setTransferDate(todayIsoDate());
    setTransferReference("");
    setTransferNotes("");
    setTransferIdempotencyKey(createIdempotencyKey());
    setTransferModalOpen(true);
  }

  async function handleTransferSubmit(event: FormEvent) {
    event.preventDefault();
    if (!transferBranchId) {
      showToast("Select a branch to transfer from", "error");
      return;
    }
    const amount = parseAccountingAmount(transferAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Enter a valid transfer amount greater than zero", "error");
      return;
    }
    if (selectedTransferBranch && amount > selectedTransferBranch.availableBalance + 0.0001) {
      showToast(
        `Amount exceeds available commission balance (${formatMoney(selectedTransferBranch.availableBalance)})`,
        "error"
      );
      return;
    }
    try {
      const result = await transferToCapital({
        branchId: transferBranchId,
        amount,
        businessDate: transferDate || todayIsoDate(),
        reference: transferReference.trim() || undefined,
        notes: transferNotes.trim() || undefined,
        idempotencyKey: transferIdempotencyKey || createIdempotencyKey()
      });
      setTransferModalOpen(false);
      setTransferIdempotencyKey(createIdempotencyKey());
      showToast(
        result.idempotent
          ? `Transfer ${result.transfer.reference} was already recorded`
          : `Allocated ${formatMoney(result.transfer.amount)} to Business Capital (Ref ${result.transfer.reference})`,
        "success"
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Transfer failed", "error");
    }
  }

  async function handleReverseSubmit(event: FormEvent) {
    event.preventDefault();
    if (!reverseTarget) {
      return;
    }
    const reason = reverseReason.trim();
    if (reason.length < 3) {
      showToast("Enter a reversal reason (at least 3 characters)", "error");
      return;
    }
    try {
      const result = await reverseTransfer(reverseTarget.id, reason);
      setReverseTarget(null);
      setReverseReason("");
      showToast(
        `Reversed ${result.transfer.reference} — ${formatMoney(result.transfer.amount)} restored to available income`,
        "success"
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Reversal failed", "error");
    }
  }

  const recentEntries = useMemo(() => {
    if (!report) {
      return [];
    }
    const base = report.recentEntries.filter((entry) =>
      branchOptions.length === 0
        ? true
        : branchOptions.some((b) => String(b.id) === String(entry.branchId))
    );
    const q = postingSearch.trim().toLowerCase();
    if (!q) {
      return base;
    }
    return base.filter((entry) => {
      const branchName =
        tenantBranchRows.find((b) => b.branchId === entry.branchId)?.branchName ??
        branchOptions.find((b) => String(b.id) === String(entry.branchId))?.name ??
        "";
      const sourceLabel = INSTITUTIONAL_INCOME_SOURCE_LABELS[entry.source] ?? entry.source;
      return (
        (entry.customerName ?? "").toLowerCase().includes(q) ||
        (entry.customerAccountNumber ?? "").toLowerCase().includes(q) ||
        branchName.toLowerCase().includes(q) ||
        sourceLabel.toLowerCase().includes(q) ||
        (entry.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [report, branchOptions, postingSearch, tenantBranchRows]);

  const periodRange = report
    ? report.fromDate === report.toDate
      ? formatShortDate(report.fromDate)
      : `${formatShortDate(report.fromDate)} – ${formatShortDate(report.toDate)}`
    : null;

  const branchesWithIncome = tenantBranchRows.filter((r) => r.amount > 0 || r.entryCount > 0);
  const capitalAllocation = report?.capitalAllocation;
  const totalEarnedAllTime = capitalAllocation?.totalEarnedAllTime ?? 0;
  const availableCommissionBalance = capitalAllocation?.availableBalance ?? 0;
  const totalTransferredToCapital = capitalAllocation?.totalTransferredToCapital ?? 0;
  const transferHistory = capitalAllocation?.transfers ?? [];
  const capitalStorageReady = capitalAllocation?.storageReady !== false;

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
            {periodRange ? (
              <span className="income-meta-pill income-meta-pill--quiet">{periodRange}</span>
            ) : null}
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
          <div className="income-hero__actions">
            {canTransferToCapital ? (
              <button
                type="button"
                className="button primary"
                disabled={
                  loading ||
                  transferring ||
                  !capitalStorageReady ||
                  availableCommissionBalance <= 0
                }
                onClick={() => openTransferModal()}
                title={
                  !capitalStorageReady
                    ? "Apply migration 110_commission_income_capital_transfers.sql in Supabase first"
                    : availableCommissionBalance <= 0
                      ? "No available commission income balance to allocate"
                      : "Allocate available commission income into Business Capital (non-cash)"
                }
              >
                Transfer to Business Capital
              </button>
            ) : null}
            <button
              type="button"
              className="button secondary income-hero__refresh"
              disabled={loading}
              onClick={() => void refresh()}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
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
          <section
            className="income-capital-card"
            aria-labelledby="income-capital-heading"
          >
            <header className="income-capital-card__head">
              <div>
                <h2 id="income-capital-heading">Commission income &amp; Business Capital</h2>
                <p className="muted">
                  Cumulative institutional fee balance across{" "}
                  {selectedBranch ? selectedBranch.name : "all branches"}. Allocating commission
                  income into Business Capital reclassifies equity without adding new physical
                  vault cash (fee cash is already held in the branch safe). Physical owner cash
                  withdrawals are recorded separately under{" "}
                  <Link to="/app/susu/closing-balances">Closing Balances → Record drawing</Link>.
                </p>
              </div>
              {canTransferToCapital ? (
                <button
                  type="button"
                  className="button primary"
                  disabled={
                    loading ||
                    transferring ||
                    !capitalStorageReady ||
                    availableCommissionBalance <= 0
                  }
                  onClick={() => openTransferModal()}
                >
                  Transfer to Business Capital
                </button>
              ) : null}
            </header>

            {!capitalStorageReady ? (
              <p className="branch-float__eod-flag branch-float__eod-flag--shortage" role="status">
                Commission-to-capital transfer storage is not ready yet. Apply migration{" "}
                <code>110_commission_income_capital_transfers.sql</code> in Supabase, then refresh.
              </p>
            ) : null}

            <div className="income-capital-kpis">
              <article className="income-capital-stat">
                <span className="income-capital-stat__label">Total commission income earned</span>
                <strong className="income-capital-stat__value">
                  {formatMoney(totalEarnedAllTime)}
                </strong>
                <span className="income-capital-stat__hint muted">
                  All-time net fee postings (after reversals)
                </span>
              </article>

              <article className="income-capital-stat income-capital-stat--available">
                <span className="income-capital-stat__label">Available commission income</span>
                <strong className="income-capital-stat__value">
                  {formatMoney(availableCommissionBalance)}
                </strong>
                <span className="income-capital-stat__hint muted">
                  Current branch income account balance ready to allocate
                </span>
              </article>

              <article className="income-capital-stat income-capital-stat--transferred">
                <span className="income-capital-stat__label">
                  Transferred to Business Capital
                </span>
                <strong className="income-capital-stat__value">
                  {formatMoney(totalTransferredToCapital)}
                </strong>
                <span className="income-capital-stat__hint muted">
                  Cumulative allocated equity (net of reversed transfers)
                </span>
              </article>
            </div>
          </section>

          <section className="income-kpi-grid" aria-label="Income by source">
            {report.bySource.length === 0 ? (
              <article className="income-kpi income-kpi--empty">
                <span className="income-kpi__label">No fee income in this period</span>
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
            <section
              className="income-panel income-panel--branches"
              aria-labelledby="income-branches-heading"
            >
              <header className="income-panel__head">
                <div>
                  <h2 id="income-branches-heading">Branches</h2>
                  <p className="muted">
                    {branchesWithIncome.length} of {tenantBranchRows.length} with income in this
                    period
                  </p>
                </div>
              </header>

              {tenantBranchRows.length === 0 ? (
                <p className="income-empty muted">No branches for this company yet.</p>
              ) : (
                <ul className="income-branch-list">
                  {tenantBranchRows.map((row) => {
                    const code = branchOptions.find(
                      (b) => String(b.id) === String(row.branchId)
                    )?.code;
                    const share =
                      report.totalAmount > 0 ? Math.round((row.amount / report.totalAmount) * 100) : 0;
                    const transferred = row.totalTransferredToCapital ?? 0;
                    return (
                      <li key={row.branchId} className="income-branch-row">
                        <div className="income-branch-row__identity">
                          <strong>{row.branchName}</strong>
                          {code ? <span className="muted">{code}</span> : null}
                        </div>
                        <div className="income-branch-row__figures">
                          <span className="income-branch-row__period">
                            {formatMoney(row.amount)}
                          </span>
                          <span className="muted">
                            {row.entryCount} · avail {formatMoney(row.accountBalance)}
                            {transferred > 0 ? ` · cap ${formatMoney(transferred)}` : ""}
                          </span>
                        </div>
                        <div
                          className="income-branch-row__bar"
                          aria-hidden
                          title={`${share}% of period total`}
                        >
                          <span
                            style={{
                              width: `${Math.min(100, Math.max(share, row.amount > 0 ? 4 : 0))}%`
                            }}
                          />
                        </div>
                        <div className="income-branch-row__footer">
                          {row.bySource.length > 0 ? (
                            <div className="income-chips">
                              {row.bySource.map((s) => (
                                <span key={s.source} className="income-chip">
                                  {INSTITUTIONAL_INCOME_SOURCE_LABELS[s.source] ?? s.label}
                                  <em>{formatMoney(s.amount)}</em>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span />
                          )}
                          {canTransferToCapital && capitalStorageReady && row.accountBalance > 0 ? (
                            <button
                              type="button"
                              className="button secondary button--sm"
                              disabled={transferring}
                              onClick={() => openTransferModal(row.branchId)}
                            >
                              Allocate
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section
              className="income-panel income-panel--ledger"
              aria-labelledby="income-ledger-heading"
            >
              <header className="income-panel__head">
                <div>
                  <h2 id="income-ledger-heading">Postings</h2>
                  <p className="muted">Fee credits in this period</p>
                </div>
                <input
                  type="search"
                  className="income-panel__search"
                  value={postingSearch}
                  onChange={(e) => setPostingSearch(e.target.value)}
                  placeholder="Search customer, account #, branch…"
                  aria-label="Search fee postings"
                />
              </header>

              {recentEntries.length === 0 ? (
                <p className="income-empty muted">
                  {postingSearch.trim()
                    ? "No postings match your search."
                    : "No postings in this period."}
                </p>
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
                      <li
                        key={entry.id}
                        className={`income-ledger__row income-ledger__row--${status}`}
                      >
                        <div className="income-ledger__when">
                          <time dateTime={entry.businessDate}>
                            {formatShortDate(entry.businessDate)}
                          </time>
                          <span className="muted">{branchName}</span>
                        </div>
                        <div className="income-ledger__what">
                          <strong>
                            {INSTITUTIONAL_INCOME_SOURCE_LABELS[entry.source] ?? entry.source}
                          </strong>
                          {entry.customerName || entry.customerAccountNumber ? (
                            <span className="income-ledger__customer">
                              <span>{entry.customerName ?? "Customer"}</span>
                              {entry.customerAccountNumber ? (
                                <code className="income-ledger__acct">
                                  {entry.customerAccountNumber}
                                </code>
                              ) : null}
                            </span>
                          ) : null}
                          <span className="muted" title={entry.notes ?? undefined}>
                            {shortenNote(entry.notes)}
                          </span>
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

          <section
            className="income-panel income-panel--transfers"
            aria-labelledby="income-transfers-heading"
          >
            <header className="income-panel__head">
              <div>
                <h2 id="income-transfers-heading">Commission transfer history</h2>
                <p className="muted">
                  Audit trail of internal allocations from branch income accounts to Business
                  Capital
                </p>
              </div>
              <span className="income-meta-pill income-meta-pill--quiet">
                {transferHistory.length} record{transferHistory.length === 1 ? "" : "s"}
              </span>
            </header>

            {transferHistory.length === 0 ? (
              <p className="income-empty muted">
                No commission transfers to Business Capital recorded yet.
              </p>
            ) : (
              <div className="admin-table-wrap">
                <div className="admin-table-scroll">
                  <table className="admin-table income-transfer-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Branch &amp; Source Account</th>
                        <th>Destination &amp; Reference</th>
                        <th className="income-transfer-col--num">Amount</th>
                        <th>Authorized By</th>
                        <th>Status</th>
                        {canTransferToCapital ? (
                          <th className="admin-table-actions-col">Action</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {transferHistory.map((item) => {
                        const isReversed = Boolean(item.reversedAt);
                        return (
                          <tr
                            key={item.id}
                            className={isReversed ? "income-transfer-row--reversed" : undefined}
                          >
                            <td className="admin-table-mono">{formatShortDate(item.businessDate)}</td>
                            <td>
                              <strong>{item.branchName ?? "Branch"}</strong>
                              <div className="muted income-transfer-sub">
                                {item.incomeAccountLabel ?? "Branch income account"}
                              </div>
                            </td>
                            <td>
                              <div className="income-transfer-ref">
                                <span>Business Capital</span>
                                <code className="income-ledger__acct">{item.reference}</code>
                              </div>
                              {item.notes ? (
                                <div className="muted income-transfer-sub" title={item.notes}>
                                  {item.notes}
                                </div>
                              ) : null}
                              {isReversed ? (
                                <div className="income-transfer-reversal-note">
                                  Reversed
                                  {item.reversedAt
                                    ? ` on ${formatShortDate(item.reversedAt.slice(0, 10))}`
                                    : ""}
                                  {item.reversedByName ? ` by ${item.reversedByName}` : ""}
                                  {item.reversalReason ? ` — ${item.reversalReason}` : ""}
                                </div>
                              ) : null}
                            </td>
                            <td className="income-transfer-col--num admin-table-mono">
                              <strong>{formatMoney(item.amount)}</strong>
                            </td>
                            <td>{item.authorizedByName ?? item.authorizedByUserId}</td>
                            <td>
                              <span
                                className={`income-status income-status--${isReversed ? "reversed" : "posted"}`}
                              >
                                {isReversed ? "Reversed" : "Allocated"}
                              </span>
                            </td>
                            {canTransferToCapital ? (
                              <td className="admin-table-actions-col">
                                {isReversed ? (
                                  <span className="muted">—</span>
                                ) : (
                                  <button
                                    type="button"
                                    className="button secondary button--sm"
                                    disabled={reversingTransferId === item.id}
                                    onClick={() => {
                                      setReverseTarget(item);
                                      setReverseReason("");
                                    }}
                                  >
                                    {reversingTransferId === item.id ? "Reversing…" : "Reverse"}
                                  </button>
                                )}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </>
      ) : null}

      <Modal
        open={transferModalOpen}
        title="Transfer commission income to Business Capital"
        subtitle="Internal equity allocation — debits available institutional income and credits Business Capital without adding physical vault cash."
        onClose={() => {
          if (!transferring) {
            setTransferModalOpen(false);
          }
        }}
        footer={
          <>
            <button
              type="button"
              className="button secondary"
              disabled={transferring}
              onClick={() => setTransferModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="income-capital-transfer-form"
              className="button primary"
              disabled={
                transferring ||
                !transferBranchId ||
                !Number.isFinite(parsedTransferAmount) ||
                parsedTransferAmount <= 0 ||
                transferExceedsAvailable
              }
            >
              {transferring ? "Allocating…" : "Confirm transfer"}
            </button>
          </>
        }
      >
        <form
          id="income-capital-transfer-form"
          className="income-transfer-form"
          onSubmit={(e) => void handleTransferSubmit(e)}
        >
          <label className="form-field">
            <span>Branch income account</span>
            <select
              value={transferBranchId}
              onChange={(e) => setTransferBranchId(e.target.value)}
              disabled={transferring}
              required
            >
              <option value="">Select branch…</option>
              {transferBranchCandidates.map((b) => (
                <option key={b.branchId} value={b.branchId}>
                  {b.branchName} — Available {formatMoney(b.availableBalance)}
                </option>
              ))}
            </select>
          </label>

          {selectedTransferBranch ? (
            <div className="income-transfer-balance-bar">
              <div>
                <span className="muted">Available balance</span>
                <strong>{formatMoney(selectedTransferBranch.availableBalance)}</strong>
              </div>
              <button
                type="button"
                className="button secondary button--sm"
                disabled={transferring || selectedTransferBranch.availableBalance <= 0}
                onClick={() =>
                  setTransferAmount(formatAccountingInput(selectedTransferBranch.availableBalance))
                }
              >
                Use full available
              </button>
            </div>
          ) : null}

          <div className="income-transfer-form__row">
            <label className="form-field">
              <span>Amount to allocate (GHS)</span>
              <AccountingAmountInput
                value={transferAmount}
                onChange={setTransferAmount}
                placeholder="0.00"
                disabled={transferring}
                required
              />
              {transferExceedsAvailable && selectedTransferBranch ? (
                <span className="error-text">
                  Exceeds available balance ({formatMoney(selectedTransferBranch.availableBalance)}).
                </span>
              ) : null}
            </label>

            <label className="form-field">
              <span>Business date</span>
              <input
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                disabled={transferring}
                required
              />
            </label>
          </div>

          <label className="form-field">
            <span>Reference (optional — auto-generated if blank)</span>
            <input
              type="text"
              value={transferReference}
              onChange={(e) => setTransferReference(e.target.value)}
              placeholder="e.g. Q4-COMMISSION-ALLOC"
              maxLength={120}
              disabled={transferring}
            />
          </label>

          <label className="form-field">
            <span>Notes (optional)</span>
            <textarea
              rows={2}
              value={transferNotes}
              onChange={(e) => setTransferNotes(e.target.value)}
              placeholder="Reason or board/owner authorization notes"
              maxLength={500}
              disabled={transferring}
            />
          </label>

          {selectedTransferBranch ? (
            <div className="income-transfer-preview" role="status">
              <div>
                <span>Available after transfer</span>
                <strong>{formatMoney(remainingAfterTransfer)}</strong>
              </div>
              <div>
                <span>Vault cash impact</span>
                <strong>{formatMoney(0)} (non-cash allocation)</strong>
              </div>
            </div>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={reverseTarget != null}
        title="Reverse commission capital transfer"
        subtitle={
          reverseTarget
            ? `Ref ${reverseTarget.reference} · ${formatMoney(reverseTarget.amount)} (${reverseTarget.branchName ?? "Branch"})`
            : undefined
        }
        onClose={() => {
          if (!reversingTransferId) {
            setReverseTarget(null);
          }
        }}
        footer={
          <>
            <button
              type="button"
              className="button secondary"
              disabled={Boolean(reversingTransferId)}
              onClick={() => setReverseTarget(null)}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="income-capital-reverse-form"
              className="button danger"
              disabled={Boolean(reversingTransferId) || reverseReason.trim().length < 3}
            >
              {reversingTransferId ? "Reversing…" : "Confirm reversal"}
            </button>
          </>
        }
      >
        <form
          id="income-capital-reverse-form"
          className="income-transfer-form"
          onSubmit={(e) => void handleReverseSubmit(e)}
        >
          <p className="muted">
            Reversing voids the linked Business Capital allocation entry and restores{" "}
            <strong>{reverseTarget ? formatMoney(reverseTarget.amount) : formatMoney(0)}</strong>{" "}
            back to the branch&apos;s available institutional income balance. Physical vault cash
            remains unchanged.
          </p>
          <label className="form-field">
            <span>Reason for reversal</span>
            <textarea
              rows={3}
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              placeholder="Explain why this allocation is being reversed…"
              minLength={3}
              maxLength={500}
              required
            />
          </label>
        </form>
      </Modal>
    </div>
  );
}
