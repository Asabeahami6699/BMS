import { FormEvent, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { CashMovementType } from "@bms/shared";
import { useBranchesLiveSync } from "./hooks/useBranchesLiveSync";
import { useBranchesStore } from "./stores/branchesStore";
import { useTreasuryStore } from "./stores/treasuryStore";
import { getActiveBranchFilter, getRuntimeBranchId, isAllBranchesScope } from "./api";

const MOVEMENT_OPTIONS: Array<{ value: CashMovementType; label: string }> = [
  { value: "vault_to_teller", label: "Vault → Teller drawer" },
  { value: "teller_to_vault", label: "Teller drawer → Vault" },
  { value: "vault_to_bank", label: "Vault → Bank deposit" },
  { value: "bank_to_vault", label: "Bank → Vault withdrawal" },
  { value: "expense", label: "Operational expense" },
  { value: "commission", label: "Commission payout" }
];

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS" }).format(value);
}

type Props = {
  canMoveCash: boolean;
  defaultBranchId?: string;
};

export function TreasuryPage({ canMoveCash, defaultBranchId }: Props) {
  useBranchesLiveSync();
  const branches = useBranchesStore((s) => s.branches);
  const { bootstrap, allBranches, loading, posting, error, hydrate, setBranchId, postMovement, startLiveSync, stopLiveSync } =
    useTreasuryStore(
      useShallow((s) => ({
        bootstrap: s.bootstrap,
        allBranches: s.allBranches,
        loading: s.loading,
        posting: s.posting,
        error: s.error,
        hydrate: s.hydrate,
        setBranchId: s.setBranchId,
        postMovement: s.postMovement,
        startLiveSync: s.startLiveSync,
        stopLiveSync: s.stopLiveSync
      }))
    );

  const [branchId, setLocalBranchId] = useState(
    defaultBranchId ?? getActiveBranchFilter() ?? getRuntimeBranchId() ?? ""
  );
  const [movementType, setMovementType] = useState<CashMovementType>("vault_to_teller");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (defaultBranchId) {
      setLocalBranchId(defaultBranchId);
      setBranchId(defaultBranchId);
    } else if (isAllBranchesScope(getRuntimeBranchId())) {
      setLocalBranchId("");
      setBranchId("");
    }
  }, [defaultBranchId, setBranchId]);

  useEffect(() => {
    hydrate({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync]);

  const tellerAccounts = useMemo(
    () => bootstrap?.accounts.filter((a) => a.kind === "teller_drawer") ?? [],
    [bootstrap?.accounts]
  );

  async function handleMovementSubmit(event: FormEvent) {
    event.preventDefault();
    const parsedAmount = Number(amount);
    if (!branchId || !parsedAmount || parsedAmount <= 0) {
      return;
    }
    await postMovement({
      branchId,
      movementType,
      amount: parsedAmount,
      notes: notes.trim() || undefined
    });
    setAmount("");
    setNotes("");
  }

  return (
    <div className="treasury-layout">
      <article className="card">
        <h2>Treasury &amp; cash control</h2>
        <p className="muted">
          Vault safe, teller drawers, and company bank accounts — aligned with branch cash movements and trial
          balance checks.
        </p>
        <label className="field">
          <span>Branch</span>
          <select
            value={branchId}
            onChange={(e) => {
              setLocalBranchId(e.target.value);
              setBranchId(e.target.value);
            }}
          >
            <option value="">Select branch…</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name} ({branch.code})
              </option>
            ))}
          </select>
        </label>
        {error ? <p className="error-text">{error}</p> : null}
      </article>

      {loading && !bootstrap && !allBranches?.length ? <p className="muted">Loading cash positions…</p> : null}

      {allBranches?.length ? (
        <section className="treasury-kpi-grid">
          {allBranches.map((entry) => (
            <article key={entry.branchId} className="card treasury-kpi">
              <span className="muted">{entry.branchName}</span>
              <strong>{formatMoney(entry.bootstrap.branchCashPosition.totalCashPosition)}</strong>
              <small className="muted">
                Vault {formatMoney(entry.bootstrap.branchCashPosition.vaultCash)} · Tellers{" "}
                {formatMoney(entry.bootstrap.branchCashPosition.tellerCash)}
              </small>
            </article>
          ))}
        </section>
      ) : null}

      {bootstrap ? (
        <>
          <section className="treasury-kpi-grid">
            <article className="card treasury-kpi">
              <span className="muted">Vault (safe)</span>
              <strong>{formatMoney(bootstrap.branchCashPosition.vaultCash)}</strong>
            </article>
            <article className="card treasury-kpi">
              <span className="muted">Teller drawers</span>
              <strong>{formatMoney(bootstrap.branchCashPosition.tellerCash)}</strong>
            </article>
            <article className="card treasury-kpi">
              <span className="muted">Bank accounts</span>
              <strong>{formatMoney(bootstrap.branchCashPosition.bankCash)}</strong>
            </article>
            <article className="card treasury-kpi">
              <span className="muted">Total cash position</span>
              <strong>{formatMoney(bootstrap.branchCashPosition.totalCashPosition)}</strong>
            </article>
          </section>

          <article className="card">
            <h3>Cash accounts</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Type</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {bootstrap.accounts.map((account) => (
                    <tr key={account.id}>
                      <td>{account.label}</td>
                      <td>{account.kind.replace(/_/g, " ")}</td>
                      <td>{formatMoney(account.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="card">
            <h3>Trial balance</h3>
            <p className="muted">
              Credit = debit when institutional cash is balanced. Variance signals leakage, missing entries, or
              fraud risk.
            </p>
            <p>
              Status:{" "}
              <strong className={bootstrap.trialBalance.isBalanced ? "text-ok" : "text-warn"}>
                {bootstrap.trialBalance.isBalanced ? "Balanced" : "Out of balance — review movements"}
              </strong>
            </p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Debit</th>
                    <th>Credit</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {bootstrap.trialBalance.lines.map((line) => (
                    <tr key={line.accountId}>
                      <td>{line.label}</td>
                      <td>{formatMoney(line.debit)}</td>
                      <td>{formatMoney(line.credit)}</td>
                      <td>{formatMoney(line.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Totals</th>
                    <th>{formatMoney(bootstrap.trialBalance.totalDebit)}</th>
                    <th>{formatMoney(bootstrap.trialBalance.totalCredit)}</th>
                    <th />
                  </tr>
                </tfoot>
              </table>
            </div>
          </article>

          {canMoveCash ? (
            <article className="card">
              <h3>Record cash movement</h3>
              <form className="form-grid" onSubmit={handleMovementSubmit}>
                <label className="field">
                  <span>Movement type</span>
                  <select value={movementType} onChange={(e) => setMovementType(e.target.value as CashMovementType)}>
                    {MOVEMENT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {movementType === "vault_to_teller" && tellerAccounts.length === 0 ? (
                  <p className="muted">
                    No teller drawer accounts yet. Allocate till float first — a drawer account is created per
                    teller.
                  </p>
                ) : null}
                <label className="field">
                  <span>Amount (GHS)</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span>Notes</span>
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
                </label>
                <button type="submit" className="btn primary" disabled={posting || !branchId}>
                  {posting ? "Posting…" : "Post movement"}
                </button>
              </form>
            </article>
          ) : null}

          <article className="card">
            <h3>Recent movements</h3>
            {bootstrap.recentMovements.length === 0 ? (
              <p className="muted">No cash movements recorded yet for this branch.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Amount</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bootstrap.recentMovements.map((movement) => (
                      <tr key={movement.id}>
                        <td>{movement.businessDate}</td>
                        <td>{movement.movementType.replace(/_/g, " ")}</td>
                        <td>{formatMoney(movement.amount)}</td>
                        <td>{movement.notes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </>
      ) : null}
    </div>
  );
}
