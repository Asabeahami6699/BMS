import { formatAccountAmount } from "@bms/shared";
import { useEffect, useState } from "react";
import type { AgentCashVarianceSummary } from "../../app/api";
import { getMyCashVariances } from "../../app/api";

function formatMoney(amount: number): string {
  return `GHS ${formatAccountAmount(amount)}`;
}

type Props = {
  /** Refresh when parent wants a reload (e.g. after callover submit). */
  refreshKey?: number;
};

export function AgentCashVariancePanel({ refreshKey = 0 }: Props) {
  const [summary, setSummary] = useState<AgentCashVarianceSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMyCashVariances({ status: "open" })
      .then((data) => {
        if (!cancelled) {
          setSummary(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSummary(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!summary) {
    return null;
  }
  if (summary.totalShortageOutstanding < 0.005 && summary.totalOverageOutstanding < 0.005) {
    return null;
  }

  return (
    <div className="agent-cash-variance-panel" aria-live="polite">
      {summary.totalShortageOutstanding >= 0.005 ? (
        <aside className="agent-cash-variance-banner agent-cash-variance-banner--shortage">
          <strong>You owe {formatMoney(summary.totalShortageOutstanding)}</strong>
          Pay shortages at the office. Later overages do not clear this debt.
          <ul className="agent-cash-variance-list">
            {summary.shortages.map((v) => (
              <li key={v.id}>
                {v.businessDate}: {formatMoney(v.outstandingAmount)} outstanding
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
      {summary.totalOverageOutstanding >= 0.005 ? (
        <aside className="agent-cash-variance-banner agent-cash-variance-banner--overage">
          <strong>Overage to reconcile {formatMoney(summary.totalOverageOutstanding)}</strong>
          Find customers you under-entered that day. Overage is not yours to keep or to offset a shortage.
          <ul className="agent-cash-variance-list">
            {summary.overages.map((v) => (
              <li key={v.id}>
                {v.businessDate}: {formatMoney(v.outstandingAmount)} open
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
