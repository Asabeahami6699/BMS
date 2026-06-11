import type { TreasuryBootstrap } from "@bms/shared";
import { Modal } from "../../components/Modal";
import { formatDeskMoney } from "./DeskMetricGrid";
import type { BranchTrialBalance } from "../stores/accountantDeskStore";

type Props = {
  open: boolean;
  onClose: () => void;
  branches: BranchTrialBalance[];
  single?: TreasuryBootstrap | null;
  dateFrom: string;
  dateTo: string;
};

function aggregateBranches(branches: BranchTrialBalance[]) {
  let vault = 0;
  let teller = 0;
  let bank = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  let unbalanced = 0;

  for (const entry of branches) {
    const pos = entry.bootstrap.branchCashPosition;
    vault += pos.vaultCash;
    teller += pos.tellerCash;
    bank += pos.bankCash;
    totalDebit += entry.bootstrap.trialBalance.totalDebit;
    totalCredit += entry.bootstrap.trialBalance.totalCredit;
    if (!entry.bootstrap.trialBalance.isBalanced) {
      unbalanced += 1;
    }
  }

  return {
    vault,
    teller,
    bank,
    totalDebit,
    totalCredit,
    unbalanced,
    isBalanced: unbalanced === 0 && branches.length > 0
  };
}

export function AccountantCompanyBalanceModal({
  open,
  onClose,
  branches,
  single,
  dateFrom,
  dateTo
}: Props) {
  const entries =
    branches.length > 0
      ? branches
      : single
        ? [
            {
              branchId: "single",
              branchName: "Selected branch",
              bootstrap: single
            }
          ]
        : [];

  const totals = aggregateBranches(entries);
  const grandCash = totals.vault + totals.teller + totals.bank;

  return (
    <Modal
      open={open}
      title="Company-wide cash position"
      subtitle={`All branches · ${dateFrom} to ${dateTo}`}
      onClose={onClose}
      panelClassName="modal-panel--70"
    >
      <div className="company-balance-modal">
        <div className="company-balance-modal__status">
          <span
            className={`trial-balance-status trial-balance-status--${
              totals.isBalanced ? "ok" : "warn"
            }`}
          >
            {totals.isBalanced ? "All branches balanced" : `${totals.unbalanced} branch(es) out of balance`}
          </span>
        </div>

        <div className="treasury-kpi-grid company-balance-modal__kpis">
          <div className="treasury-kpi treasury-kpi--highlight">
            <span className="muted">Total institutional cash</span>
            <strong>{formatDeskMoney(grandCash)}</strong>
          </div>
          <div className="treasury-kpi">
            <span className="muted">Vault (all branches)</span>
            <strong>{formatDeskMoney(totals.vault)}</strong>
          </div>
          <div className="treasury-kpi">
            <span className="muted">Teller drawers</span>
            <strong>{formatDeskMoney(totals.teller)}</strong>
          </div>
          <div className="treasury-kpi">
            <span className="muted">Partner banks</span>
            <strong>{formatDeskMoney(totals.bank)}</strong>
          </div>
          <div className="treasury-kpi">
            <span className="muted">Trial debit total</span>
            <strong>{formatDeskMoney(totals.totalDebit)}</strong>
          </div>
          <div className="treasury-kpi">
            <span className="muted">Trial credit total</span>
            <strong>{formatDeskMoney(totals.totalCredit)}</strong>
          </div>
        </div>

        <div className="desk-data-table__scroll">
          <table className="desk-data-table__grid company-balance-modal__table">
            <thead>
              <tr>
                <th>Branch</th>
                <th className="desk-data-table__num">Vault</th>
                <th className="desk-data-table__num">Tellers</th>
                <th className="desk-data-table__num">Bank</th>
                <th className="desk-data-table__num">Total cash</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const pos = entry.bootstrap.branchCashPosition;
                const branchTotal = pos.vaultCash + pos.tellerCash + pos.bankCash;
                const balanced = entry.bootstrap.trialBalance.isBalanced;
                return (
                  <tr key={entry.branchId}>
                    <td>
                      <strong>{entry.branchName}</strong>
                      {entry.branchCode ? (
                        <span className="muted"> ({entry.branchCode})</span>
                      ) : null}
                    </td>
                    <td className="desk-data-table__num">{formatDeskMoney(pos.vaultCash)}</td>
                    <td className="desk-data-table__num">{formatDeskMoney(pos.tellerCash)}</td>
                    <td className="desk-data-table__num">{formatDeskMoney(pos.bankCash)}</td>
                    <td className="desk-data-table__num">
                      <strong>{formatDeskMoney(branchTotal)}</strong>
                    </td>
                    <td>
                      <span
                        className={`trial-balance-status trial-balance-status--${
                          balanced ? "ok" : "warn"
                        }`}
                      >
                        {balanced ? "Balanced" : "Review"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th>Company total</th>
                <th className="desk-data-table__num">{formatDeskMoney(totals.vault)}</th>
                <th className="desk-data-table__num">{formatDeskMoney(totals.teller)}</th>
                <th className="desk-data-table__num">{formatDeskMoney(totals.bank)}</th>
                <th className="desk-data-table__num">{formatDeskMoney(grandCash)}</th>
                <th />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </Modal>
  );
}
