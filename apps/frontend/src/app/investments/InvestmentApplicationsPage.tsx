import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { InvestmentStatus } from "@bms/shared";
import type { AppRole } from "../api";
import { useShallow } from "zustand/react/shallow";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import {
  INVESTMENT_STATUS_LABELS,
  selectFilteredPortfolio,
  useInvestmentStore
} from "../stores/investmentStore";
import { formatInvestmentMoney } from "./investmentUi";
import { InvestmentsLayout } from "./InvestmentsLayout";

type Props = { role: AppRole };

const STATUS_OPTIONS = Object.keys(INVESTMENT_STATUS_LABELS) as InvestmentStatus[];

export function InvestmentApplicationsPage({ role: _role }: Props) {
  const { showToast } = useToast();
  const loading = useInvestmentStore((s) => s.loading);
  const error = useInvestmentStore((s) => s.error);
  const products = useInvestmentStore((s) => s.products);
  const refresh = useInvestmentStore((s) => s.refresh);
  const portfolioSearch = useInvestmentStore((s) => s.portfolioSearch);
  const portfolioStatus = useInvestmentStore((s) => s.portfolioStatus);
  const portfolioProductId = useInvestmentStore((s) => s.portfolioProductId);
  const setPortfolioSearch = useInvestmentStore((s) => s.setPortfolioSearch);
  const setPortfolioStatus = useInvestmentStore((s) => s.setPortfolioStatus);
  const setPortfolioProductId = useInvestmentStore((s) => s.setPortfolioProductId);

  const filtered = useInvestmentStore(useShallow(selectFilteredPortfolio));

  const activeProducts = useMemo(() => products.filter((p) => p.status === "active"), [products]);

  return (
    <InvestmentsLayout
      activeNav="applications"
      title="Investment portfolio"
      subtitle="Search and manage customer investments."
      actions={
        <button
          type="button"
          className="button secondary"
          disabled={loading}
          onClick={() => {
            void refresh().catch((err) =>
              showToast(toUserFacingError(err, "Failed to refresh portfolio"), "error")
            );
          }}
        >
          {loading ? "…" : "↻"}
        </button>
      }
    >
      {error ? <p className="overview-error">{error}</p> : null}

      <div className="investments-filter-bar">
        <label className="investments-filter-bar__search">
          <span className="sr-only">Search portfolio</span>
          <input
            type="search"
            className="investments-filter-bar__input"
            placeholder="Search customer, phone, investment #, product…"
            value={portfolioSearch}
            onChange={(e) => setPortfolioSearch(e.target.value)}
          />
        </label>
        <label className="field investments-filter-bar__select">
          <span>Product</span>
          <select value={portfolioProductId} onChange={(e) => setPortfolioProductId(e.target.value)}>
            <option value="">All products</option>
            {activeProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field investments-filter-bar__select">
          <span>Status</span>
          <select
            value={portfolioStatus}
            onChange={(e) => setPortfolioStatus(e.target.value as InvestmentStatus | "")}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {INVESTMENT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <p className="investments-filter-bar__count muted">
          {filtered.length} result{filtered.length === 1 ? "" : "s"}
        </p>
      </div>

      <section className="overview-panel">
        {loading && filtered.length === 0 ? <p className="muted">Loading…</p> : null}
        {!loading && filtered.length === 0 ? (
          <p className="muted">No investments match your filters.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Investment #</th>
                <th>Customer</th>
                <th>Phone</th>
                <th>Product</th>
                <th>Branch</th>
                <th>Principal</th>
                <th>Maturity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link to={`/app/investments/applications/${row.id}`}>{row.investmentNumber}</Link>
                  </td>
                  <td>{row.customerName}</td>
                  <td>{row.customerPhone ?? "—"}</td>
                  <td>{row.productName}</td>
                  <td>{row.branchName ?? row.branchId}</td>
                  <td>{formatInvestmentMoney(row.principalAmount)}</td>
                  <td>{row.maturityDate}</td>
                  <td>
                    <span className={`status-pill status-pill--${row.status === "active" ? "active" : "pending"}`}>
                      {INVESTMENT_STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </InvestmentsLayout>
  );
}
