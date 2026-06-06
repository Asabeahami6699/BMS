import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { AppRole } from "./api";
import { useLoanPermissions } from "./hooks/useLoanPermissions";
import { LoansLayout } from "./loans/LoansLayout";
import { formatLoanMoney } from "./loans/loanUi";
import { selectLoansKpis, useLoansStore } from "./stores/loansStore";

type Props = { role: AppRole };

const KPI_ITEMS = [
  { key: "pending", label: "Pending approval", className: "loans-kpi--warning" },
  { key: "approved", label: "Ready to disburse", className: "loans-kpi--primary" },
  { key: "disbursed", label: "Active loans", className: "loans-kpi--success" },
  { key: "overdue", label: "Overdue installments", className: "loans-kpi--danger" },
  { key: "outstanding", label: "Outstanding", className: "" },
  { key: "repaid", label: "Total repaid", className: "" }
] as const;

export function LoansOverviewPage({ role: _role }: Props) {
  const { canCreateApplication } = useLoanPermissions();
  const loading = useLoansStore((s) => s.loading);
  const error = useLoansStore((s) => s.error);
  const lastFetchedAt = useLoansStore((s) => s.lastFetchedAt);
  const liveSyncActive = useLoansStore((s) => s.liveSyncActive);
  const products = useLoansStore((s) => s.products);
  const applications = useLoansStore((s) => s.applications);
  const kpis = useLoansStore(useShallow(selectLoansKpis));
  const refresh = useLoansStore((s) => s.refresh);

  const updatedLabel = useMemo(() => {
    if (!lastFetchedAt) {
      return loading ? "Loading…" : "Not loaded yet";
    }
    return `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}${liveSyncActive ? " · Live" : ""}`;
  }, [lastFetchedAt, liveSyncActive, loading]);

  function kpiValue(key: (typeof KPI_ITEMS)[number]["key"]): string {
    if (!lastFetchedAt && loading) {
      return "—";
    }
    if (key === "pending") {
      return String(kpis.pendingApproval);
    }
    if (key === "approved") {
      return String(kpis.approved);
    }
    if (key === "disbursed") {
      return String(kpis.disbursed);
    }
    if (key === "overdue") {
      return String(kpis.overdueInstallments);
    }
    if (key === "outstanding") {
      return formatLoanMoney(kpis.totalOutstanding);
    }
    return formatLoanMoney(kpis.totalRepaid);
  }

  return (
    <LoansLayout
      activeNav="overview"
      title="Loans & credit"
      subtitle={`Products, applications, disbursements, and repayment tracking — ${updatedLabel}`}
      actions={
        <>
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "…" : "↻"}
          </button>
          {canCreateApplication ? (
            <Link to="/app/loans/apply" className="button primary">
              New application
            </Link>
          ) : null}
        </>
      }
    >
      {error ? <p className="loans-field-error loans-animate-in">{error}</p> : null}
      <div className="loans-kpi-grid">
        {KPI_ITEMS.map((item, index) => (
          <article
            key={item.key}
            className={`loans-kpi ${item.className} loans-animate-in loans-animate-in--${Math.min(index + 1, 8)}`}
          >
            <p className="loans-kpi__value">{kpiValue(item.key)}</p>
            <span className="loans-kpi__label">{item.label}</span>
          </article>
        ))}
      </div>

      <div className="loans-quick-grid loans-animate-in loans-animate-in--4">
        <Link to="/app/loans/products" className="loans-quick-card">
          <h3>Loan products</h3>
          <p>Configure rates, terms, and weekly or monthly repayment frequency.</p>
          <span>{products.length} products</span>
        </Link>
        <Link to="/app/loans/applications" className="loans-quick-card">
          <h3>Loan portfolio</h3>
          <p>Approve, disburse, and track repayments through to closure.</p>
          <span>{applications.length} applications</span>
        </Link>
        {canCreateApplication ? (
          <Link to="/app/loans/apply" className="loans-quick-card loans-quick-card--accent">
            <h3>Apply for a loan</h3>
            <p>Register a new borrower or select an existing customer.</p>
            <span>Start wizard →</span>
          </Link>
        ) : null}
        <Link to="/app/loans/form" className="loans-quick-card">
          <h3>Blank application form</h3>
          <p>Download or print the official loan form for offline walk-ins.</p>
          <span>Open form hub →</span>
        </Link>
      </div>
    </LoansLayout>
  );
}
