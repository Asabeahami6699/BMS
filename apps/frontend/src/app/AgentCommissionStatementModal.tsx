import { formatAccountAmount } from "@bms/shared";
import { useEffect, useState } from "react";
import type { StaffCommissionStatement } from "./api";
import { getStaffCommissionStatement } from "./api";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";

type Props = {
  open: boolean;
  userId: string | null;
  staffName?: string;
  onClose: () => void;
};

function money(amount: number, currency = "GHS"): string {
  return `${currency} ${formatAccountAmount(amount)}`;
}

export function AgentCommissionStatementModal({ open, userId, staffName, onClose }: Props) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [statement, setStatement] = useState<StaffCommissionStatement | null>(null);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    setLoading(true);
    setStatement(null);
    void getStaffCommissionStatement(userId)
      .then((data) => {
        if (!cancelled) setStatement(data);
      })
      .catch((err) => {
        if (!cancelled) {
          showToast(
            err instanceof Error ? err.message : "Failed to load commission statement",
            "error"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, userId, showToast]);

  const formulaLabel = statement
    ? statement.isOverride
      ? `Personal override (${statement.effectivePercent}%)`
      : statement.method === "cycle_share"
        ? `(${money(statement.totalCollected, statement.currency)} ÷ ${statement.cycleDays}) × ${statement.multiplier}`
        : `${statement.effectivePercent}% of total collected`
    : "";

  return (
    <Modal
      open={open && Boolean(userId)}
      onClose={onClose}
      title={`Commission breakdown — ${statement?.fullName ?? staffName ?? "Staff"}`}
      subtitle={
        statement
          ? `Payroll period ${statement.period.label} (${statement.period.startDate} to ${statement.period.endDate})`
          : "Monthly posted collections & commission audit"
      }
      panelClassName="modal-panel--70"
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {loading ? (
        <p className="muted">Loading commission breakdown…</p>
      ) : !statement ? (
        <p className="muted">No statement data available.</p>
      ) : (
        <div className="commission-stmt">
          <div className="statements-kpis">
            <article className="statements-kpi">
              <span className="statements-kpi__label">Posted collections</span>
              <strong className="statements-kpi__value">
                {money(statement.totalCollected, statement.currency)}
              </strong>
              <span className="statements-kpi__sub">
                {statement.dailyBreakdown.length} active collection day(s)
              </span>
            </article>
            <article className="statements-kpi statements-kpi--primary">
              <span className="statements-kpi__label">Earned commission</span>
              <strong className="statements-kpi__value">
                {money(statement.totalCommission, statement.currency)}
              </strong>
              <span className="statements-kpi__sub">
                Base {money(statement.baseCommission, statement.currency)}
                {statement.tierBonus > 0
                  ? ` + Bonus ${money(statement.tierBonus, statement.currency)}`
                  : ""}
              </span>
            </article>
            <article className="statements-kpi statements-kpi--debit">
              <span className="statements-kpi__label">Open shortages</span>
              <strong className="statements-kpi__value">
                {money(statement.openShortagesTotal, statement.currency)}
              </strong>
              <span className="statements-kpi__sub">
                {statement.openShortageCount} unresolved OS case(s)
              </span>
            </article>
            <article className="statements-kpi statements-kpi--credit">
              <span className="statements-kpi__label">Net after shortages</span>
              <strong className="statements-kpi__value">
                {money(statement.netAfterShortages, statement.currency)}
              </strong>
              <span className="statements-kpi__sub">Reference figure before payroll</span>
            </article>
          </div>

          <div className="eod-guard-list__row" style={{ margin: "0.85rem 0" }}>
            <span>
              <strong>Formula applied:</strong> {formulaLabel}
            </span>
            <span className="muted">
              {statement.policyEnabled ? "Commission policy active" : "Commission policy disabled"}
            </span>
          </div>

          {statement.dailyBreakdown.length === 0 ? (
            <p className="muted">No posted collections recorded in this payroll period yet.</p>
          ) : (
            <div className="statements-table-wrap">
              <table className="statements-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="statements-table__num">Transactions</th>
                    <th className="statements-table__num">Amount collected</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.dailyBreakdown.map((row) => (
                    <tr key={row.date}>
                      <td>{row.date}</td>
                      <td className="statements-table__num">{row.transactionCount}</td>
                      <td className="statements-table__num statements-table__amount statements-table__amount--credit">
                        {money(row.totalAmount, statement.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
