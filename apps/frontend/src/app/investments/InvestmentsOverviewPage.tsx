import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { AppRole } from "../api";
import { useInvestmentPermissions } from "../hooks/useInvestmentPermissions";
import { InvestmentsLayout } from "./InvestmentsLayout";
import { formatInvestmentMoney } from "./investmentUi";
import { selectInvestmentKpis, useInvestmentStore } from "../stores/investmentStore";

type Props = { role: AppRole };

const KPI_ITEMS = [
  { key: "active", label: "Active investments", tone: "primary" as const },
  { key: "matured", label: "Matured", tone: "purple" as const },
  { key: "redeemed", label: "Redeemed", tone: "success" as const },
  { key: "autoRenewed", label: "Auto-renewed cycles", tone: undefined },
  { key: "principal", label: "Total principal", tone: "primary" as const },
  { key: "interest", label: "Expected interest", tone: undefined }
] as const;

export function InvestmentsOverviewPage({ role: _role }: Props) {
  const { canCreateApplication } = useInvestmentPermissions();
  const loading = useInvestmentStore((s) => s.loading);
  const error = useInvestmentStore((s) => s.error);
  const lastFetchedAt = useInvestmentStore((s) => s.lastFetchedAt);
  const liveSyncActive = useInvestmentStore((s) => s.liveSyncActive);
  const products = useInvestmentStore((s) => s.products);
  const investments = useInvestmentStore((s) => s.investments);
  const kpis = useInvestmentStore(useShallow(selectInvestmentKpis));
  const refresh = useInvestmentStore((s) => s.refresh);

  const updatedLabel = useMemo(() => {
    if (!lastFetchedAt) {
      return loading ? "Loading…" : "Not loaded yet";
    }
    return `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}${liveSyncActive ? " · Live" : ""}`;
  }, [lastFetchedAt, liveSyncActive, loading]);

  function kpiValue(key: (typeof KPI_ITEMS)[number]["key"]): string {
    if (!lastFetchedAt && loading) {
      return "…";
    }
    if (key === "active") return String(kpis.active);
    if (key === "matured") return String(kpis.matured);
    if (key === "redeemed") return String(kpis.redeemed);
    if (key === "autoRenewed") return String(kpis.autoRenewed);
    if (key === "principal") return formatInvestmentMoney(kpis.totalPrincipal);
    return formatInvestmentMoney(kpis.totalExpectedInterest);
  }

  return (
    <InvestmentsLayout
      activeNav="overview"
      title="Investment overview"
      subtitle={`Fixed deposits, treasury bills, bonds, and shares — ${updatedLabel}`}
      actions={
        <>
          <button type="button" className="button secondary" disabled={loading} onClick={() => void refresh()}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          {canCreateApplication ? (
            <Link to="/app/investments/apply" className="button primary">
              New application
            </Link>
          ) : null}
        </>
      }
    >
      {error ? <p className="overview-error">{error}</p> : null}

      <section className="kpi-grid overview-kpis" aria-label="Investment metrics">
        {KPI_ITEMS.map((item) => (
          <article
            key={item.key}
            className={`kpi-card${item.tone ? ` kpi-card--${item.tone}` : ""}`}
          >
            <p className="kpi-label">{item.label}</p>
            <p className="kpi-value">{kpiValue(item.key)}</p>
          </article>
        ))}
      </section>

      <section className="overview-panel">
        <h2 className="overview-panel__title">Recent investments</h2>
        {investments.length === 0 ? (
          <p className="muted">No investments yet.</p>
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
              {investments.slice(0, 8).map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link to={`/app/investments/applications/${row.id}`}>{row.investmentNumber}</Link>
                  </td>
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

      <section className="overview-panel">
        <h2 className="overview-panel__title">Active products</h2>
        <p className="overview-panel__lead muted">
          {products.filter((p) => p.status === "active").length} active — configure tenure/rate tiers under{" "}
          <Link to="/app/investments/products">Products & rates</Link>.
        </p>
      </section>
    </InvestmentsLayout>
  );
}
