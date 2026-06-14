import { useEffect, useRef } from "react";
import type { InvestmentRecord } from "@bms/shared";
import { useShallow } from "zustand/react/shallow";
import type { AppRole } from "../api";
import { RowActionsMenu } from "../../components/RowActionsMenu";
import { useToast } from "../../components/Toast";
import { useInvestmentPermissions } from "../hooks/useInvestmentPermissions";
import { selectInvestmentKpis, useInvestmentStore } from "../stores/investmentStore";
import { formatInvestmentMoney } from "./investmentUi";
import { InvestmentsLayout } from "./InvestmentsLayout";

type Props = { role: AppRole };

export function InvestmentReportsPage({ role: _role }: Props) {
  const { canApprove, canViewReports } = useInvestmentPermissions();
  const { showToast } = useToast();
  const loadedRef = useRef(false);
  const loading = useInvestmentStore((s) => s.reportsLoading);
  const error = useInvestmentStore((s) => s.reportsError);
  const summary = useInvestmentStore((s) => s.summary);
  const kpis = useInvestmentStore(useShallow(selectInvestmentKpis));
  const active = useInvestmentStore((s) => s.reportActive);
  const matured = useInvestmentStore((s) => s.reportMatured);
  const redeemed = useInvestmentStore((s) => s.reportRedeemed);
  const autoRenewed = useInvestmentStore((s) => s.reportAutoRenewed);

  useEffect(() => {
    if (!canViewReports || loadedRef.current) {
      return;
    }
    loadedRef.current = true;
    void useInvestmentStore.getState().loadReports();
  }, [canViewReports]);

  async function runMaturityProcessing() {
    try {
      const count = await useInvestmentStore.getState().processMaturities();
      showToast(`Processed maturities — ${count} auto-renewed`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to process maturities", "error");
    }
  }

  const headerActions = (
    <RowActionsMenu
      ariaLabel="Report actions"
      items={[
        {
          label: loading ? "Refreshing…" : "Refresh reports",
          onClick: () => void useInvestmentStore.getState().loadReports({ force: true })
        },
        ...(canApprove
          ? [{ label: "Process maturities", onClick: () => void runMaturityProcessing() }]
          : [])
      ]}
    />
  );

  if (!canViewReports) {
    return (
      <InvestmentsLayout activeNav="reports" title="Investment reports">
        <p className="muted">You do not have permission to view investment reports.</p>
      </InvestmentsLayout>
    );
  }

  return (
    <InvestmentsLayout activeNav="reports" title="Investment reports" actions={headerActions}>
      {error ? <p className="overview-error">{error}</p> : null}
      {loading && !summary ? <p className="muted">Loading reports…</p> : null}
      {summary ? (
        <section className="kpi-grid overview-kpis">
          <article className="kpi-card kpi-card--primary">
            <p className="kpi-label">Active</p>
            <p className="kpi-value">{kpis.active}</p>
          </article>
          <article className="kpi-card kpi-card--purple">
            <p className="kpi-label">Matured</p>
            <p className="kpi-value">{kpis.matured}</p>
          </article>
          <article className="kpi-card kpi-card--success">
            <p className="kpi-label">Redeemed</p>
            <p className="kpi-value">{kpis.redeemed}</p>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Portfolio principal</p>
            <p className="kpi-value">{formatInvestmentMoney(kpis.totalPrincipal)}</p>
          </article>
        </section>
      ) : null}
      <ReportTable title="Active investments" rows={active} loading={loading} />
      <ReportTable title="Matured investments" rows={matured} loading={loading} />
      <ReportTable title="Redeemed investments" rows={redeemed} loading={loading} />
      <ReportTable title="Auto-renewed cycles" rows={autoRenewed} loading={loading} />
    </InvestmentsLayout>
  );
}

function ReportTable({
  title,
  rows,
  loading
}: {
  title: string;
  rows: InvestmentRecord[];
  loading: boolean;
}) {
  return (
    <section className="overview-panel">
      <h2 className="overview-panel__title">
        {title} ({rows.length})
      </h2>
      {loading && rows.length === 0 ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">None</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Customer</th>
              <th>Product</th>
              <th>Principal</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map((row) => (
              <tr key={row.id}>
                <td>{row.investmentNumber}</td>
                <td>{row.customerName}</td>
                <td>{row.productName}</td>
                <td>{formatInvestmentMoney(row.principalAmount)}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
