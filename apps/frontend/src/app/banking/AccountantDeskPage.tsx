import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AccountantDashboard } from "@bms/shared";
import { getAccountantDashboard } from "../api";
import { formatWorkspaceMoney } from "../stores/roleWorkspaceStore";
import { DeskMetricGrid, formatDeskMoney } from "./DeskMetricGrid";
import { DeskSummaryTable } from "./DeskSummaryTable";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";

type Props = { displayName?: string };

export function AccountantDeskPage({ displayName }: Props) {
  const config = getRoleDeskConfig("accountant");
  const [data, setData] = useState<AccountantDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getAccountantDashboard({ branchId: "all" }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load accountant dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sections = useMemo(() => {
    if (!data) {
      return [];
    }
    const t = data.totals;
    return [
      {
        title: "Cash & liquidity",
        subtitle: "Live positions from vault, teller drawers, and partner bank accounts.",
        metrics: [
          { id: "vault", label: "Cash in vault", value: formatDeskMoney(t.cashInVault), tone: "primary" as const },
          { id: "bank", label: "Cash in bank", value: formatDeskMoney(t.cashInBank), tone: "violet" as const },
          { id: "tellers", label: "Teller drawers", value: formatDeskMoney(t.tellerCash), tone: "neutral" as const },
          { id: "net", label: "Net cash position", value: formatDeskMoney(t.netCashPosition), tone: "success" as const }
        ]
      },
      {
        title: "Transaction flow",
        subtitle: "Institutional deposits and withdrawals recorded across branches.",
        metrics: [
          { id: "dep", label: "Total deposits", value: formatDeskMoney(t.totalDeposits), tone: "success" as const },
          { id: "wd", label: "Total withdrawals", value: formatDeskMoney(t.totalWithdrawals), tone: "warning" as const },
          { id: "exp", label: "Total expenses", value: formatDeskMoney(t.totalExpenses), tone: "danger" as const },
          { id: "com", label: "Commission income", value: formatDeskMoney(t.commissionIncome), tone: "primary" as const }
        ]
      },
      {
        title: "Portfolios",
        subtitle: "Outstanding loans and fixed-deposit savings balances.",
        metrics: [
          { id: "loan", label: "Loan portfolio", value: formatDeskMoney(t.loanPortfolio), tone: "violet" as const },
          { id: "fd", label: "Fixed deposit portfolio", value: formatDeskMoney(t.fixedDepositPortfolio), tone: "primary" as const },
          {
            id: "appr",
            label: "Pending approvals",
            value: data.pendingApprovals,
            tone: data.pendingApprovals > 0 ? ("warning" as const) : ("neutral" as const)
          },
          {
            id: "unbal",
            label: "Unbalanced branches",
            value: data.unbalancedBranches,
            tone: data.unbalancedBranches > 0 ? ("danger" as const) : ("success" as const)
          }
        ]
      }
    ];
  }, [data]);

  return (
    <RoleDeskShell
      config={config}
      displayName={displayName}
      error={error}
      loading={loading && !data}
      onRefresh={() => void load()}
      refreshing={loading}
    >
      <section className="card role-workspace__panel desk-hero-panel">
        <div className="desk-hero-panel__row">
          <div>
            <p className="desk-hero-panel__eyebrow">Accountant dashboard</p>
            <h3>Branch financial control centre</h3>
            <p className="muted">
              Deposits, withdrawals, cash positions, portfolios, and branch summaries in one view.
            </p>
          </div>
          <div className="role-workspace__quick-grid desk-hero-panel__actions">
            <Link className="role-workspace__quick-card" to="/app/banking/accountant/approvals">
              <strong>Approvals</strong>
              <span>{data?.pendingApprovals ?? 0} pending</span>
            </Link>
            <Link className="role-workspace__quick-card" to="/app/banking/accountant/trial-balance">
              <strong>Trial balance</strong>
              <span>Vault · bank · teller</span>
            </Link>
            <Link className="role-workspace__quick-card" to="/app/banking/accountant/reports">
              <strong>Reports</strong>
              <span>Analytics export</span>
            </Link>
          </div>
        </div>
      </section>

      {data ? <DeskMetricGrid sections={sections} /> : null}

      {data && data.branchSummary.length > 0 ? (
        <DeskSummaryTable
          title="Branch financial summary"
          subtitle="Deposits, withdrawals, and net flow by branch."
          rowKey={(row) => row.branchId}
          columns={[
            {
              key: "branch",
              label: "Branch",
              render: (row) => (
                <>
                  <strong>{row.branchName ?? row.branchId}</strong>
                  {row.branchCode ? <span className="muted"> ({row.branchCode})</span> : null}
                </>
              )
            },
            {
              key: "deposits",
              label: "Deposits",
              align: "right",
              render: (row) => formatWorkspaceMoney(row.deposits)
            },
            {
              key: "withdrawals",
              label: "Withdrawals",
              align: "right",
              render: (row) => formatWorkspaceMoney(row.withdrawals)
            },
            {
              key: "netFlow",
              label: "Net flow",
              align: "right",
              render: (row) => (
                <span className={row.netFlow >= 0 ? "desk-data-table__pos" : "desk-data-table__neg"}>
                  {formatWorkspaceMoney(row.netFlow)}
                </span>
              )
            },
            {
              key: "transactionCount",
              label: "Transactions",
              render: (row) => <span className="muted">{row.transactionCount}</span>
            }
          ]}
          rows={data.branchSummary}
        />
      ) : null}
    </RoleDeskShell>
  );
}
