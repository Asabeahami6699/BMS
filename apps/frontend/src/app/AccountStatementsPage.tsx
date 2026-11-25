import {
  SUSU_COMMISSION_DEBIT_TAG,
  SUSU_COMMISSION_REFUND_TAG,
  formatAccountAmount,
  ledgerDisplayReason
} from "@bms/shared";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { AppRole, Customer, LedgerEntry } from "./api";
import { printCustomerAccountStatement } from "./customerAccountStatement";
import { useBranchesStore } from "./stores/branchesStore";
import {
  selectLedgerForCustomer,
  useCustomerLedgerStore
} from "./stores/customerLedgerStore";
import { useCustomersStore } from "./stores/customersStore";
import { useSusuCycleCommissionStore } from "./stores/susuCycleCommissionStore";
import { useAuth } from "../auth/AuthContext";
import { SusuPassbookCard } from "../components/SusuPassbookCard";
import { useToast } from "../components/Toast";
import { downloadCustomerLedgerCsv } from "../lib/customerLedgerCsv";

const LEDGER_PAGE_SIZE = 25;

type DatePreset = "7d" | "30d" | "90d" | "all";
type EntryFilter = "all" | "credit" | "debit";
type ViewTab = "overview" | "ledger" | "passbook";

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgoIsoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function customerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? "CU").toUpperCase();
}

function formatLedgerDate(iso: string): { date: string; time: string } {
  try {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      }),
      time: d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit"
      })
    };
  } catch {
    return { date: iso, time: "" };
  }
}

function entryTypeLabel(entry: LedgerEntry): string {
  if (entry.transactionType === "susu_reversal") {
    return "Reversal";
  }
  const reasonOrNotes = `${entry.reason ?? ""} ${entry.notes ?? ""}`.toLowerCase();
  if (reasonOrNotes.includes(SUSU_COMMISSION_DEBIT_TAG)) {
    return "Debit (commission)";
  }
  if (reasonOrNotes.includes(SUSU_COMMISSION_REFUND_TAG)) {
    return "Commission refund";
  }
  if (reasonOrNotes.includes("loan repayment")) {
    return "Loan repayment";
  }
  if (reasonOrNotes.includes("settled shortage")) {
    return "Settled shortage";
  }
  if (entry.transactionType === "daily_susu") {
    return "Daily Susu";
  }
  if (entry.transactionType === "deposit") {
    return "Deposit";
  }
  if (entry.transactionType === "withdrawal") {
    return "Withdrawal";
  }
  return entry.entryType === "credit" ? "Credit" : "Debit";
}

function entryReason(entry: LedgerEntry): string {
  if (entry.reason?.trim()) {
    return ledgerDisplayReason(entry.reason) ?? entry.reason.trim();
  }
  if (entry.notes?.trim()) {
    return ledgerDisplayReason(entry.notes) ?? "—";
  }
  return "—";
}

function entryIsoDay(iso: string): string {
  return iso.slice(0, 10);
}

type Props = {
  role: AppRole;
};

export function AccountStatementsPage({ role }: Props) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    customers,
    loading: customersLoading,
    hydrate: hydrateCustomers,
    refresh: refreshCustomers,
    startLiveSync: startCustomersLiveSync,
    stopLiveSync: stopCustomersLiveSync
  } = useCustomersStore(
    useShallow((s) => ({
      customers: s.customers,
      loading: s.loading,
      hydrate: s.hydrate,
      refresh: s.refresh,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  const { branches, hydrate: hydrateBranches } = useBranchesStore(
    useShallow((s) => ({
      branches: s.branches,
      hydrate: s.hydrate
    }))
  );

  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [branchFilter, setBranchFilter] = useState("");
  const [accountTypeFilter, setAccountTypeFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string>(() => searchParams.get("customerId") ?? "");

  const [activeTab, setActiveTab] = useState<ViewTab>("overview");
  const [datePreset, setDatePreset] = useState<DatePreset>("30d");
  const [statementFromDate, setStatementFromDate] = useState(() => daysAgoIsoDate(30));
  const [statementToDate, setStatementToDate] = useState(() => todayIsoDate());
  const [entryFilter, setEntryFilter] = useState<EntryFilter>("all");
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerVisibleCount, setLedgerVisibleCount] = useState(LEDGER_PAGE_SIZE);
  const [printBusy, setPrintBusy] = useState(false);
  const [failedPhotos, setFailedPhotos] = useState<Record<string, true>>({});

  useEffect(() => {
    hydrateCustomers();
    hydrateBranches();
    startCustomersLiveSync();
    return () => {
      stopCustomersLiveSync();
    };
  }, [hydrateCustomers, hydrateBranches, startCustomersLiveSync, stopCustomersLiveSync]);

  const detailByCustomer = useCustomerLedgerStore((s) => s.detailByCustomer);

  const branchNameById = useMemo(
    () => new Map(branches.map((b) => [b.id, `${b.name} (${b.code})`])),
    [branches]
  );

  const filteredCustomers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      if (branchFilter && c.homeBranchId !== branchFilter) {
        return false;
      }
      if (accountTypeFilter !== "all" && (c.accountType ?? "susu") !== accountTypeFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      const haystack = [c.fullName, c.accountNumber, c.phone, c.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [customers, branchFilter, accountTypeFilter, query]);

  const selectedCustomer: Customer | null = useMemo(() => {
    const base =
      (selectedId ? customers.find((c) => c.id === selectedId) : undefined) ??
      filteredCustomers[0] ??
      null;
    if (!base) return null;
    const detail = detailByCustomer[base.id];
    return detail ? { ...base, ...detail } : base;
  }, [customers, filteredCustomers, selectedId, detailByCustomer]);

  const activeCustomerId = selectedCustomer?.id ?? "";
  const isSusuAccount = (selectedCustomer?.accountType ?? "susu") === "susu";

  useEffect(() => {
    if (!isSusuAccount && activeTab === "passbook") {
      setActiveTab("ledger");
    }
  }, [isSusuAccount, activeTab]);

  const ledger = useCustomerLedgerStore((s) => selectLedgerForCustomer(s, activeCustomerId));
  const ledgerLoading = useCustomerLedgerStore((s) =>
    activeCustomerId ? Boolean(s.loadingByCustomer[activeCustomerId]) : false
  );
  const ledgerError = useCustomerLedgerStore((s) =>
    activeCustomerId ? (s.errorByCustomer[activeCustomerId] ?? null) : null
  );
  const passbookLoading = useSusuCycleCommissionStore((s) =>
    activeCustomerId ? Boolean(s.summaryLoadingByCustomer[activeCustomerId]) : false
  );

  useEffect(() => {
    if (!activeCustomerId) {
      return;
    }
    setLedgerVisibleCount(LEDGER_PAGE_SIZE);
    const store = useCustomerLedgerStore.getState();
    void store.ensureLedger(activeCustomerId, { force: true });
    void store.ensureDetail(activeCustomerId, { force: true });
    if (isSusuAccount) {
      void useSusuCycleCommissionStore
        .getState()
        .ensureCustomerPassbook(activeCustomerId, { force: true });
    }
    store.startLiveSync();
    return () => useCustomerLedgerStore.getState().stopLiveSync();
  }, [activeCustomerId, isSusuAccount]);

  function selectCustomer(customer: Customer) {
    setSelectedId(customer.id);
    setLedgerSearch("");
    setLedgerVisibleCount(LEDGER_PAGE_SIZE);
    const next = new URLSearchParams(searchParams);
    next.set("customerId", customer.id);
    setSearchParams(next, { replace: true });
  }

  function applyPreset(preset: DatePreset) {
    setDatePreset(preset);
    if (preset === "all") {
      setStatementFromDate("");
      setStatementToDate("");
    } else {
      const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
      setStatementFromDate(daysAgoIsoDate(days));
      setStatementToDate(todayIsoDate());
    }
    setLedgerVisibleCount(LEDGER_PAGE_SIZE);
  }

  const accountBalance = ledger.length > 0 ? ledger[ledger.length - 1]!.balanceAfter : 0;

  const periodFilteredLedger = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    return [...ledger]
      .reverse()
      .filter((entry) => {
        const day = entryIsoDay(entry.createdAt);
        if (statementFromDate && day < statementFromDate) return false;
        if (statementToDate && day > statementToDate) return false;
        if (entryFilter !== "all" && entry.entryType !== entryFilter) return false;
        if (q) {
          const text = [
            entryTypeLabel(entry),
            entryReason(entry),
            entry.performedByName,
            entry.recordedByName,
            String(entry.amount)
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!text.includes(q)) return false;
        }
        return true;
      });
  }, [ledger, statementFromDate, statementToDate, entryFilter, ledgerSearch]);

  const periodStats = useMemo(() => {
    let totalCredits = 0;
    let creditCount = 0;
    let totalDebits = 0;
    let debitCount = 0;
    for (const entry of periodFilteredLedger) {
      if (entry.entryType === "credit") {
        totalCredits += entry.amount;
        creditCount += 1;
      } else {
        totalDebits += entry.amount;
        debitCount += 1;
      }
    }
    return {
      totalCredits: Math.round(totalCredits * 100) / 100,
      creditCount,
      totalDebits: Math.round(totalDebits * 100) / 100,
      debitCount
    };
  }, [periodFilteredLedger]);

  const displayedLedger = useMemo(
    () => periodFilteredLedger.slice(0, ledgerVisibleCount),
    [periodFilteredLedger, ledgerVisibleCount]
  );
  const olderEntriesCount = Math.max(0, periodFilteredLedger.length - ledgerVisibleCount);

  function handleDownloadCsv() {
    if (!selectedCustomer || ledger.length === 0) return;
    try {
      downloadCustomerLedgerCsv(selectedCustomer, ledger);
      showToast("Ledger CSV downloaded", "success");
    } catch {
      showToast("Failed to download ledger CSV", "error");
    }
  }

  async function handlePrintStatement() {
    if (!selectedCustomer || ledger.length === 0 || printBusy) return;
    setPrintBusy(true);
    try {
      showToast("Preparing statement PDF…", "info");
      await printCustomerAccountStatement({
        customer: selectedCustomer,
        ledger,
        companyName: user?.tenantName,
        fromDate: statementFromDate || undefined,
        toDate: statementToDate || undefined
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not print statement", "error");
    } finally {
      setPrintBusy(false);
    }
  }

  async function handleCopyAccountNumber(accountNumber: string) {
    try {
      await navigator.clipboard.writeText(accountNumber);
      showToast(`Copied ${accountNumber}`, "success");
    } catch {
      showToast("Could not copy account number", "error");
    }
  }

  async function handleShareSummary() {
    if (!selectedCustomer) return;
    const company = user?.tenantName?.trim() || "Our office";
    const summaryText = [
      `${company} — Account Summary`,
      `Customer: ${selectedCustomer.fullName}`,
      selectedCustomer.accountNumber ? `Account: ${selectedCustomer.accountNumber}` : null,
      `Current Balance: GHS ${formatAccountAmount(accountBalance)}`,
      `Period Credits: +GHS ${formatAccountAmount(periodStats.totalCredits)} (${periodStats.creditCount})`,
      `Period Debits: -GHS ${formatAccountAmount(periodStats.totalDebits)} (${periodStats.debitCount})`,
      `As of: ${new Date().toLocaleDateString()}`
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(summaryText);
      showToast("Account summary copied — ready to paste in WhatsApp/SMS", "success");
    } catch {
      /* continue to WhatsApp link if phone available */
    }

    const digits = (selectedCustomer.phone ?? "").replace(/\D/g, "");
    if (digits.length >= 9) {
      const intl = digits.startsWith("0") ? `233${digits.slice(1)}` : digits;
      window.open(
        `https://wa.me/${intl}?text=${encodeURIComponent(summaryText)}`,
        "_blank",
        "noopener,noreferrer"
      );
    }
  }

  const canFilterBranches =
    role === "admin" || role === "accountant" || role === "auditor" || branches.length > 1;

  const showPassbook = isSusuAccount && (activeTab === "overview" || activeTab === "passbook");
  const showLedger = activeTab === "overview" || activeTab === "ledger";

  return (
    <div className="statements-page">
      <header className="overview-hero statements-hero">
        <div>
          <p className="overview-hero__eyebrow">Susu management · Customer records</p>
          <h1 className="overview-hero__title">Account statements &amp; passbook</h1>
          <p className="overview-hero__sub muted">
            Inspect any authorised customer&apos;s live ledger, virtual Susu passbook, print
            official PDF statements, or export CSV.
          </p>
        </div>
        <div className="statements-hero__actions">
          <button
            type="button"
            className="button secondary"
            disabled={customersLoading || ledgerLoading || passbookLoading}
            onClick={() => {
              const tasks: Promise<unknown>[] = [
                refreshCustomers(),
                useBranchesStore.getState().refreshSilent()
              ];
              if (activeCustomerId) {
                const ledgerStore = useCustomerLedgerStore.getState();
                tasks.push(ledgerStore.ensureLedger(activeCustomerId, { force: true }));
                tasks.push(ledgerStore.ensureDetail(activeCustomerId, { force: true }));
                if (isSusuAccount) {
                  tasks.push(
                    useSusuCycleCommissionStore
                      .getState()
                      .ensureCustomerPassbook(activeCustomerId, { force: true })
                  );
                }
              }
              void Promise.allSettled(tasks);
            }}
          >
            {customersLoading || ledgerLoading || passbookLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="statements-workspace">
        {/* Left column: Customer Directory */}
        <aside className="overview-panel statements-finder" aria-label="Customer directory">
          <div className="statements-finder__head">
            <h2 className="statements-finder__title">Customers</h2>
            <span className="statements-finder__pill">{filteredCustomers.length}</span>
          </div>

          <div className="statements-finder__controls">
            <div className="statements-search-box">
              <span className="statements-search-box__icon" aria-hidden>
                ⌕
              </span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, account no., phone…"
                aria-label="Search customer"
              />
              {query ? (
                <button
                  type="button"
                  className="statements-search-box__clear"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                >
                  ×
                </button>
              ) : null}
            </div>

            <div className="statements-finder__filters">
              {canFilterBranches ? (
                <select
                  aria-label="Filter by branch"
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                >
                  <option value="">All branches</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              ) : null}
              <select
                aria-label="Filter by account type"
                value={accountTypeFilter}
                onChange={(e) => setAccountTypeFilter(e.target.value)}
              >
                <option value="all">All types</option>
                <option value="susu">Susu</option>
                <option value="savings">Savings</option>
                <option value="group">Group</option>
                <option value="meba_daakye">Meba Daakye</option>
              </select>
            </div>
          </div>

          <div className="statements-finder__list" role="listbox" aria-label="Customer accounts">
            {customersLoading && customers.length === 0 ? (
              <div className="statements-finder__skeletons" aria-busy="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="statements-finder__skeleton" />
                ))}
              </div>
            ) : filteredCustomers.length === 0 ? (
              <div className="statements-finder__empty">
                <p className="muted">No customer accounts match your filter.</p>
                {query || branchFilter || accountTypeFilter !== "all" ? (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setQuery("");
                      setBranchFilter("");
                      setAccountTypeFilter("all");
                    }}
                  >
                    Reset filters
                  </button>
                ) : null}
              </div>
            ) : (
              filteredCustomers.slice(0, 150).map((c) => {
                const active = c.id === activeCustomerId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`statements-finder__item${active ? " statements-finder__item--active" : ""}`}
                    onClick={() => selectCustomer(c)}
                  >
                    <span className="statements-finder__avatar" aria-hidden>
                      {customerInitials(c.fullName)}
                    </span>
                    <span className="statements-finder__body">
                      <span className="statements-finder__item-top">
                        <strong className="statements-finder__name">{c.fullName}</strong>
                        <span className="statements-finder__badge">
                          {(c.accountType ?? "susu").replace(/_/g, " ")}
                        </span>
                      </span>
                      <span className="statements-finder__sub">
                        <span className="statements-mono">{c.accountNumber || "Pending acct"}</span>
                        {c.phone ? <span>· {c.phone}</span> : null}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right column: Selected Customer Statement & Passbook */}
        <section className="statements-main" aria-label="Account statement details">
          {!selectedCustomer ? (
            <div className="overview-panel statements-empty-state">
              <div className="statements-empty-state__icon" aria-hidden>
                ▤
              </div>
              <h2>Select a customer account</h2>
              <p className="muted">
                Choose a customer from the directory on the left to inspect their running ledger,
                Susu passbook, and downloadable PDF or CSV statement.
              </p>
            </div>
          ) : (
            <>
              {/* Customer identity hero card */}
              <div className="overview-panel statements-customer-card">
                <div className="statements-customer-card__identity">
                  <div className="statements-customer-card__avatar">
                    {selectedCustomer.photoUrl && !failedPhotos[selectedCustomer.id] ? (
                      <img
                        src={selectedCustomer.photoUrl}
                        alt={selectedCustomer.fullName}
                        onError={() =>
                          setFailedPhotos((prev) => ({ ...prev, [selectedCustomer.id]: true }))
                        }
                      />
                    ) : (
                      <span aria-hidden>{customerInitials(selectedCustomer.fullName)}</span>
                    )}
                  </div>
                  <div className="statements-customer-card__info">
                    <div className="statements-customer-card__title-row">
                      <h2 className="statements-customer-card__name">
                        {selectedCustomer.fullName}
                      </h2>
                      <span
                        className={`statements-status-pill statements-status-pill--${
                          selectedCustomer.status === "active" ? "active" : "muted"
                        }`}
                      >
                        {selectedCustomer.status.replace(/_/g, " ")}
                      </span>
                      <span className="statements-type-pill">
                        {(selectedCustomer.accountType ?? "susu").replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="statements-customer-card__meta">
                      {selectedCustomer.accountNumber ? (
                        <button
                          type="button"
                          className="statements-acct-chip"
                          title="Copy account number"
                          onClick={() =>
                            void handleCopyAccountNumber(selectedCustomer.accountNumber!)
                          }
                        >
                          <span className="statements-mono">{selectedCustomer.accountNumber}</span>
                          <span aria-hidden>⧉</span>
                        </button>
                      ) : (
                        <span className="muted">Pending account number</span>
                      )}
                      {selectedCustomer.phone ? (
                        <span className="statements-meta-sep">{selectedCustomer.phone}</span>
                      ) : null}
                      {selectedCustomer.homeBranchId &&
                      branchNameById.has(selectedCustomer.homeBranchId) ? (
                        <span className="statements-meta-sep">
                          {branchNameById.get(selectedCustomer.homeBranchId)}
                        </span>
                      ) : null}
                      {isSusuAccount && Number(selectedCustomer.dailyContributionAmount ?? 0) > 0 ? (
                        <span className="statements-meta-sep">
                          Daily plan: GHS{" "}
                          {formatAccountAmount(Number(selectedCustomer.dailyContributionAmount))}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="statements-customer-card__actions">
                  <button
                    type="button"
                    className="button"
                    disabled={ledgerLoading || ledger.length === 0 || printBusy}
                    onClick={() => void handlePrintStatement()}
                  >
                    {printBusy ? "Preparing PDF…" : "Print statement"}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={ledgerLoading}
                    onClick={() => void handleShareSummary()}
                  >
                    Share summary
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={ledgerLoading || ledger.length === 0}
                    onClick={handleDownloadCsv}
                  >
                    Export CSV
                  </button>
                </div>
              </div>

              {/* Financial KPI summary strip */}
              <div className="statements-kpis">
                <article className="statements-kpi statements-kpi--primary">
                  <span className="statements-kpi__label">Current balance</span>
                  <strong className="statements-kpi__value">
                    {ledgerLoading && ledger.length === 0
                      ? "…"
                      : `GHS ${formatAccountAmount(accountBalance)}`}
                  </strong>
                  <span className="statements-kpi__sub">Latest running ledger balance</span>
                </article>
                <article className="statements-kpi statements-kpi--credit">
                  <span className="statements-kpi__label">Credits (period)</span>
                  <strong className="statements-kpi__value">
                    +GHS {formatAccountAmount(periodStats.totalCredits)}
                  </strong>
                  <span className="statements-kpi__sub">
                    {periodStats.creditCount} credit entr{periodStats.creditCount === 1 ? "y" : "ies"}
                  </span>
                </article>
                <article className="statements-kpi statements-kpi--debit">
                  <span className="statements-kpi__label">Debits (period)</span>
                  <strong className="statements-kpi__value">
                    −GHS {formatAccountAmount(periodStats.totalDebits)}
                  </strong>
                  <span className="statements-kpi__sub">
                    {periodStats.debitCount} debit entr{periodStats.debitCount === 1 ? "y" : "ies"}
                  </span>
                </article>
                <article className="statements-kpi">
                  <span className="statements-kpi__label">Entries shown</span>
                  <strong className="statements-kpi__value">{periodFilteredLedger.length}</strong>
                  <span className="statements-kpi__sub">of {ledger.length} total ledger rows</span>
                </article>
              </div>

              {/* View switcher tabs */}
              <div className="statements-tabs" role="tablist" aria-label="Statement view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "overview"}
                  className={`statements-tab${activeTab === "overview" ? " statements-tab--active" : ""}`}
                  onClick={() => setActiveTab("overview")}
                >
                  {isSusuAccount ? "Passbook & Ledger" : "Statement overview"}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "ledger"}
                  className={`statements-tab${activeTab === "ledger" ? " statements-tab--active" : ""}`}
                  onClick={() => setActiveTab("ledger")}
                >
                  Account ledger ({periodFilteredLedger.length})
                </button>
                {isSusuAccount ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "passbook"}
                    className={`statements-tab${activeTab === "passbook" ? " statements-tab--active" : ""}`}
                    onClick={() => setActiveTab("passbook")}
                  >
                    Susu passbook
                  </button>
                ) : null}
              </div>

              {/* Susu Passbook panel */}
              {showPassbook ? (
                <div className="overview-panel statements-section">
                  <SusuPassbookCard
                    customerId={selectedCustomer.id}
                    customerName={selectedCustomer.fullName}
                    accountNumber={selectedCustomer.accountNumber}
                  />
                </div>
              ) : null}

              {/* Ledger table panel */}
              {showLedger ? (
                <div className="overview-panel statements-section">
                  <div className="statements-ledger-header">
                    <div>
                      <h3 className="statements-section__title">Account ledger</h3>
                      <p className="muted statements-section__sub">
                        {periodFilteredLedger.length === 0
                          ? "No ledger entries in this period"
                          : `Showing ${displayedLedger.length} of ${periodFilteredLedger.length} matching entries (newest first)`}
                      </p>
                    </div>

                    <div className="statements-presets" role="group" aria-label="Date range presets">
                      {(
                        [
                          { id: "7d", label: "7D" },
                          { id: "30d", label: "30D" },
                          { id: "90d", label: "90D" },
                          { id: "all", label: "All time" }
                        ] as const
                      ).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={`statements-preset-btn${
                            datePreset === p.id ? " statements-preset-btn--active" : ""
                          }`}
                          onClick={() => applyPreset(p.id)}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="statements-ledger-filters">
                    <div className="statements-type-pills" role="group" aria-label="Entry type">
                      {(
                        [
                          { id: "all", label: "All" },
                          { id: "credit", label: "Credits" },
                          { id: "debit", label: "Debits" }
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          className={`statements-filter-pill${
                            entryFilter === opt.id ? " statements-filter-pill--active" : ""
                          }`}
                          onClick={() => {
                            setEntryFilter(opt.id);
                            setLedgerVisibleCount(LEDGER_PAGE_SIZE);
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <div className="statements-ledger-controls">
                      <input
                        type="text"
                        className="statements-ledger-search"
                        value={ledgerSearch}
                        onChange={(e) => setLedgerSearch(e.target.value)}
                        placeholder="Filter reason, staff, amount…"
                        aria-label="Filter ledger entries"
                      />
                      <label className="statements-date-input">
                        <span>From</span>
                        <input
                          type="date"
                          value={statementFromDate}
                          max={statementToDate || undefined}
                          onChange={(e) => {
                            setStatementFromDate(e.target.value);
                            setDatePreset("all");
                          }}
                        />
                      </label>
                      <label className="statements-date-input">
                        <span>To</span>
                        <input
                          type="date"
                          value={statementToDate}
                          min={statementFromDate || undefined}
                          onChange={(e) => {
                            setStatementToDate(e.target.value);
                            setDatePreset("all");
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  {ledgerError ? (
                    <div className="statements-ledger-empty" role="status">
                      <p className="muted">{ledgerError}</p>
                    </div>
                  ) : ledgerLoading && ledger.length === 0 ? (
                    <div className="statements-ledger-empty">
                      <p className="muted">Loading account history…</p>
                    </div>
                  ) : periodFilteredLedger.length === 0 ? (
                    <div className="statements-ledger-empty">
                      <p className="muted">
                        No transactions found for the current filters. Try switching to{" "}
                        <button
                          type="button"
                          className="statements-inline-link"
                          onClick={() => {
                            applyPreset("all");
                            setEntryFilter("all");
                            setLedgerSearch("");
                          }}
                        >
                          All time
                        </button>
                        .
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="statements-table-wrap">
                        <table className="statements-table" aria-label="Account ledger entries">
                          <thead>
                            <tr>
                              <th>Date &amp; time</th>
                              <th>Type</th>
                              <th>Description / reason</th>
                              <th>Recorded by</th>
                              <th className="statements-table__num">Amount</th>
                              <th className="statements-table__num">Balance after</th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayedLedger.map((entry) => {
                              const dt = formatLedgerDate(entry.createdAt);
                              const typeLabel = entryTypeLabel(entry);
                              const reason = entryReason(entry);
                              const staff = entry.performedByName ?? entry.recordedByName ?? "—";
                              const isCredit = entry.entryType === "credit";
                              return (
                                <tr key={entry.id}>
                                  <td className="statements-table__date">
                                    <strong>{dt.date}</strong>
                                    {dt.time ? <small className="muted">{dt.time}</small> : null}
                                  </td>
                                  <td>
                                    <span
                                      className={`statements-entry-badge statements-entry-badge--${
                                        entry.transactionType === "susu_reversal"
                                          ? "reversal"
                                          : isCredit
                                            ? "credit"
                                            : "debit"
                                      }`}
                                      title={entry.notes ?? undefined}
                                    >
                                      {typeLabel}
                                      {entry.reversalStatus === "reversed" ? " · Reversed" : ""}
                                    </span>
                                  </td>
                                  <td className="statements-table__reason" title={reason}>
                                    {reason}
                                  </td>
                                  <td className="statements-table__staff">{staff}</td>
                                  <td
                                    className={`statements-table__num statements-table__amount statements-table__amount--${
                                      isCredit ? "credit" : "debit"
                                    }`}
                                  >
                                    {isCredit ? "+" : "−"}GHS {formatAccountAmount(entry.amount)}
                                  </td>
                                  <td className="statements-table__num statements-table__balance">
                                    GHS {formatAccountAmount(entry.balanceAfter)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {olderEntriesCount > 0 ? (
                        <div className="statements-table-more">
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => setLedgerVisibleCount((n) => n + LEDGER_PAGE_SIZE)}
                          >
                            Show {Math.min(LEDGER_PAGE_SIZE, olderEntriesCount)} more entries (
                            {olderEntriesCount} remaining)
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
