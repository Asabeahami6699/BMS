import { useEffect, useMemo, useState } from "react";
import type { TellerReconciliationTab, TenantBankProduct } from "@bms/shared";
import { useShallow } from "zustand/react/shallow";
import { listBankProducts } from "../api";
import { useBranchesLiveSync } from "../hooks/useBranchesLiveSync";
import { useBranchesStore } from "../stores/branchesStore";
import { useTellerReconciliationStore } from "../stores/tellerReconciliationStore";
import { TellerTransactionRecords } from "./TellerTransactionRecords";

type Props = {
  compact?: boolean;
  fallbackBranchId?: string;
};

const TABS: Array<{ id: TellerReconciliationTab; label: string }> = [
  { id: "opening", label: "Opening" },
  { id: "deposits", label: "Deposits" },
  { id: "withdrawals", label: "Withdrawals" },
  { id: "closing", label: "Closing" },
  { id: "difference", label: "Difference" }
];

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `GHS ${value.toFixed(2)}`;
}

function compactMoney(value: number): string {
  if (value >= 1000) {
    return `GHS ${(value / 1000).toFixed(1)}k`;
  }
  return `GHS ${value.toFixed(0)}`;
}

export function TellerReconciliationWorkbench({ compact, fallbackBranchId }: Props) {
  const [activeTab, setActiveTab] = useState<TellerReconciliationTab>("deposits");
  const [bankProducts, setBankProducts] = useState<TenantBankProduct[]>([]);
  const branches = useBranchesStore((s) => s.branches);

  useBranchesLiveSync();

  useEffect(() => {
    void listBankProducts({ activeOnly: true })
      .then(setBankProducts)
      .catch(() => setBankProducts([]));
  }, []);

  const {
    data,
    businessDate,
    branchId,
    transactionType,
    bankProductId,
    loading,
    error,
    hydrate,
    startLiveSync,
    stopLiveSync,
    setBusinessDate,
    setBranchId,
    setTransactionType,
    setBankProductId
  } = useTellerReconciliationStore(
    useShallow((s) => ({
      data: s.data,
      businessDate: s.businessDate,
      branchId: s.branchId,
      transactionType: s.transactionType,
      bankProductId: s.bankProductId,
      loading: s.loading,
      error: s.error,
      hydrate: s.hydrate,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync,
      setBusinessDate: s.setBusinessDate,
      setBranchId: s.setBranchId,
      setTransactionType: s.setTransactionType,
      setBankProductId: s.setBankProductId
    }))
  );

  useEffect(() => {
    hydrate({ fallbackBranchId });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync, fallbackBranchId]);

  useEffect(() => {
    if (!branchId && branches.length > 0) {
      setBranchId(fallbackBranchId && branches.some((b) => b.id === fallbackBranchId)
        ? fallbackBranchId
        : branches[0].id);
    }
  }, [branchId, branches, fallbackBranchId, setBranchId]);

  const row = data?.rows[0] ?? null;
  const allTransactions = data?.transactions ?? [];

  const liveTotals = useMemo(() => {
    const deposits = allTransactions
      .filter((tx) => tx.type === "deposit" || tx.type === "daily_susu")
      .reduce((sum, tx) => sum + tx.amount, 0);
    const withdrawals = allTransactions
      .filter((tx) => tx.type === "withdrawal")
      .reduce((sum, tx) => sum + tx.amount, 0);
    const opening = row?.opening ?? 0;
    const expectedClosing = opening + deposits - withdrawals;
    const actualClosing = row?.closing;
    const difference =
      actualClosing != null && Number.isFinite(actualClosing)
        ? actualClosing - expectedClosing
        : row?.difference ?? null;
    return { deposits, withdrawals, expectedClosing, difference, actualClosing };
  }, [allTransactions, row]);

  const tabTransactions = useMemo(() => {
    if (activeTab === "deposits") {
      return allTransactions.filter((tx) => tx.type === "deposit" || tx.type === "daily_susu");
    }
    if (activeTab === "withdrawals") {
      return allTransactions.filter((tx) => tx.type === "withdrawal");
    }
    return allTransactions;
  }, [activeTab, allTransactions]);

  const tabBadges = useMemo(
    () => ({
      opening: row?.opening != null ? compactMoney(row.opening) : null,
      deposits: liveTotals.deposits > 0 ? compactMoney(liveTotals.deposits) : null,
      withdrawals: liveTotals.withdrawals > 0 ? compactMoney(liveTotals.withdrawals) : null,
      closing:
        liveTotals.expectedClosing != null && Number.isFinite(liveTotals.expectedClosing)
          ? compactMoney(liveTotals.expectedClosing)
          : null,
      difference:
        liveTotals.difference != null && Number.isFinite(liveTotals.difference)
          ? compactMoney(Math.abs(liveTotals.difference))
          : null
    }),
    [liveTotals, row?.opening]
  );

  return (
    <div className={`teller-recon-workbench${compact ? " teller-recon-workbench--compact" : ""}`}>
      <div className="teller-recon-filters">
        {branches.length > 0 ? (
          <label className="field">
            <span>Branch</span>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Select branch…</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span>Date</span>
          <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Transaction type</span>
          <select
            value={transactionType}
            onChange={(e) =>
              setTransactionType(e.target.value as "" | "deposit" | "withdrawal" | "daily_susu")
            }
          >
            <option value="">All types</option>
            <option value="deposit">Deposit</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="daily_susu">Daily Susu</option>
          </select>
        </label>
        <label className="field">
          <span>Bank product</span>
          <select value={bankProductId} onChange={(e) => setBankProductId(e.target.value)}>
            <option value="">All products</option>
            {bankProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {product.bankLabel} — {product.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="teller-recon-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`teller-recon-tab${activeTab === tab.id ? " is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.label}</span>
            {tabBadges[tab.id] ? (
              <span className="teller-recon-tab__badge">{tabBadges[tab.id]}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="teller-recon-tab-panel">
        {activeTab === "opening" ? (
          <div className="teller-recon-summary-grid">
            <article className="teller-recon-summary-card">
              <span className="muted">Opening float</span>
              <strong>{money(row?.opening)}</strong>
            </article>
            <article className="teller-recon-summary-card">
              <span className="muted">Teller</span>
              <strong>{row?.tellerName ?? "—"}</strong>
            </article>
            <article className="teller-recon-summary-card">
              <span className="muted">Session status</span>
              <strong>{row?.status ?? "—"}</strong>
            </article>
          </div>
        ) : null}

        {activeTab === "deposits" ? (
          <>
            <p className="teller-recon-tab-total">
              Total deposits <strong>{money(liveTotals.deposits)}</strong>
            </p>
            <TellerTransactionRecords
              transactions={tabTransactions}
              loading={loading}
              title="Deposit transactions"
            />
          </>
        ) : null}

        {activeTab === "withdrawals" ? (
          <>
            <p className="teller-recon-tab-total">
              Total withdrawals <strong>{money(liveTotals.withdrawals)}</strong>
            </p>
            <TellerTransactionRecords
              transactions={tabTransactions}
              loading={loading}
              title="Withdrawal transactions"
            />
          </>
        ) : null}

        {activeTab === "closing" ? (
          <div className="teller-recon-summary-grid">
            <article className="teller-recon-summary-card">
              <span className="muted">Expected closing</span>
              <strong>{money(liveTotals.expectedClosing)}</strong>
            </article>
            <article className="teller-recon-summary-card">
              <span className="muted">Actual closing</span>
              <strong>{money(liveTotals.actualClosing)}</strong>
            </article>
            <article className="teller-recon-summary-card">
              <span className="muted">Transactions</span>
              <strong>{row?.transactionCount ?? allTransactions.length}</strong>
            </article>
          </div>
        ) : null}

        {activeTab === "difference" ? (
          <div className="teller-recon-summary-grid">
            <article className="teller-recon-summary-card teller-recon-summary-card--variance">
              <span className="muted">Variance / difference</span>
              <strong
                className={
                  liveTotals.difference != null && liveTotals.difference < 0
                    ? "teller-recon-diff--short"
                    : liveTotals.difference != null && liveTotals.difference > 0
                      ? "teller-recon-diff--over"
                      : undefined
                }
              >
                {money(liveTotals.difference)}
              </strong>
            </article>
            <article className="teller-recon-summary-card">
              <span className="muted">Expected vs actual</span>
              <strong>
                {money(liveTotals.expectedClosing)} → {money(liveTotals.actualClosing)}
              </strong>
            </article>
            <article className="teller-recon-summary-card">
              <span className="muted">Live from transactions</span>
              <strong>
                {money(row?.opening)} + {money(liveTotals.deposits)} − {money(liveTotals.withdrawals)}
              </strong>
            </article>
          </div>
        ) : null}
      </div>
    </div>
  );
}
