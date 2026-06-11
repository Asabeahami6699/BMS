import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { formatWorkspaceMoney } from "../stores/roleWorkspaceStore";
import { useAuditorDeskStore } from "../stores/auditorDeskStore";
import { DeskMetricGrid } from "./DeskMetricGrid";
import { DeskSummaryTable } from "./DeskSummaryTable";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";

type Props = { displayName?: string };

export function AuditorDeskPage({ displayName }: Props) {
  const config = getRoleDeskConfig("auditor");
  const {
    data,
    loading,
    error,
    lastFetchedAt,
    hydrateDashboard,
    refreshDashboard,
    startLiveSync,
    stopLiveSync
  } = useAuditorDeskStore(
    useShallow((s) => ({
      data: s.dashboard,
      loading: s.dashboardLoading,
      error: s.error,
      lastFetchedAt: s.lastDashboardAt,
      hydrateDashboard: s.hydrateDashboard,
      refreshDashboard: s.refreshDashboard,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  useEffect(() => {
    hydrateDashboard({ force: true, branchId: "all" });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrateDashboard, startLiveSync, stopLiveSync]);

  const sections = useMemo(() => {
    if (!data) {
      return [];
    }
    return [
      {
        title: "Review queue",
        subtitle: "Items that need auditor attention before close of business.",
        metrics: [
          {
            id: "review",
            label: "Transactions needing review",
            value: data.transactionsNeedingReview,
            tone: data.transactionsNeedingReview > 0 ? ("warning" as const) : ("success" as const)
          },
          {
            id: "high",
            label: "High value transactions",
            value: data.highValueTransactions,
            hint: `≥ GHS ${data.highValueThreshold.toLocaleString()}`,
            tone: "primary" as const
          },
          {
            id: "reversed",
            label: "Reversed transactions",
            value: data.reversedTransactions,
            tone: data.reversedTransactions > 0 ? ("danger" as const) : ("neutral" as const)
          }
        ]
      },
      {
        title: "Cash & vault control",
        subtitle: "Teller vs back-office differences and vault trial-balance gaps.",
        metrics: [
          {
            id: "cash",
            label: "Cash differences",
            value: data.cashDifferences,
            tone: data.cashDifferences > 0 ? ("danger" as const) : ("success" as const)
          },
          {
            id: "vault",
            label: "Vault difference",
            value: data.vaultDifference,
            hint: "Branches out of balance",
            tone: data.vaultDifference > 0 ? ("warning" as const) : ("success" as const)
          }
        ]
      },
      {
        title: "Compliance & activity",
        subtitle: "User actions, policy exceptions, and fraud-risk signals.",
        metrics: [
          {
            id: "logs",
            label: "User activity logs (today)",
            value: data.userActivityLogs,
            tone: "neutral" as const
          },
          {
            id: "except",
            label: "Compliance exceptions",
            value: data.complianceExceptions,
            tone: data.complianceExceptions > 0 ? ("warning" as const) : ("success" as const)
          },
          {
            id: "fraud",
            label: "Fraud alerts",
            value: data.fraudAlerts,
            tone: data.fraudAlerts > 0 ? ("danger" as const) : ("success" as const)
          }
        ]
      }
    ];
  }, [data]);

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  return (
    <RoleDeskShell
      config={config}
      displayName={displayName}
      updatedLabel={updatedLabel}
      error={error}
      loading={loading && !data}
      onRefresh={() => void refreshDashboard()}
      refreshing={loading}
    >
      <section className="card role-workspace__panel desk-hero-panel desk-hero-panel--auditor">
        <div className="desk-hero-panel__row">
          <div>
            <p className="desk-hero-panel__eyebrow">Auditor dashboard</p>
            <h3>Assurance &amp; compliance centre</h3>
            <p className="muted">
              Monitor review queues, cash control variances, user activity, and exception patterns.
            </p>
          </div>
          <div className="role-workspace__quick-grid desk-hero-panel__actions">
            <Link className="role-workspace__quick-card" to="/app/banking/auditor/logs">
              <strong>Activity logs</strong>
              <span>Full audit trail</span>
            </Link>
            <Link className="role-workspace__quick-card" to="/app/banking/auditor/exceptions">
              <strong>Exceptions</strong>
              <span>Failed &amp; denied actions</span>
            </Link>
            <Link className="role-workspace__quick-card" to="/app/banking/auditor/reports">
              <strong>Reports</strong>
              <span>Operational analytics</span>
            </Link>
          </div>
        </div>
      </section>

      {data ? <DeskMetricGrid sections={sections} /> : null}

      {data && data.reviewQueue.length > 0 ? (
        <DeskSummaryTable
          title="Priority review list"
          subtitle="Deposits and high-value transactions needing auditor attention."
          rowKey={(row) => `${row.kind}-${row.id}`}
          columns={[
            {
              key: "kind",
              label: "Type",
              render: (row) => <span className="desk-data-table__tag">{row.kind.replace(/_/g, " ")}</span>
            },
            {
              key: "label",
              label: "Item",
              render: (row) => <strong>{row.label}</strong>
            },
            { key: "branchName", label: "Branch", render: (row) => row.branchName ?? "—" },
            {
              key: "amount",
              label: "Amount",
              align: "right",
              render: (row) => (row.amount != null ? formatWorkspaceMoney(row.amount) : "—")
            }
          ]}
          rows={data.reviewQueue}
        />
      ) : null}
    </RoleDeskShell>
  );
}
