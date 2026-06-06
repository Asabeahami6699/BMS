import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { LoanApplication, LoanApplicationStatus, LoanType } from "@bms/shared";
import type { AppRole } from "./api";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { useLoanPermissions } from "./hooks/useLoanPermissions";
import { LoansLayout } from "./loans/LoansLayout";
import {
  formatLoanDateTime,
  formatLoanMoney,
  frequencyLabel,
  loanTypeLabel,
  LOAN_STATUS_LABELS,
  LOAN_STATUS_PILL,
  customerDisplayName
} from "./loans/loanUi";
import { useLoansStore } from "./stores/loansStore";

type Props = { role: AppRole };

export function LoanApplicationsPage({ role: _role }: Props) {
  const { showToast } = useToast();
  const { canCreateApplication } = useLoanPermissions();
  const loading = useLoansStore((s) => s.loading);
  const error = useLoansStore((s) => s.error);
  const applications = useLoansStore((s) => s.applications);
  const refresh = useLoansStore((s) => s.refresh);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | LoanApplicationStatus>("");
  const [typeFilter, setTypeFilter] = useState<"" | LoanType>("");

  const filtered = useMemo(() => {
    let list = applications;
    if (statusFilter) {
      list = list.filter((a) => a.status === statusFilter);
    }
    if (typeFilter) {
      list = list.filter((a) => (a.loanType ?? "individual") === typeFilter);
    }
    return filterRowsBySearch(list, search, [
      "customerName",
      "productName",
      "groupName",
      "applicationNotes",
      "occupation"
    ] as (keyof LoanApplication)[]);
  }, [applications, search, statusFilter, typeFilter]);

  return (
    <LoansLayout
      activeNav="applications"
      title="Loan portfolio"
      subtitle="Track applications from submission through approval, disbursement, and repayment."
      actions={
        <>
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => {
              void refresh().catch((err) =>
                showToast(toUserFacingError(err, "Failed to refresh applications"), "error")
              );
            }}
          >
            {loading ? "…" : "↻"}
          </button>
          {canCreateApplication ? (
            <>
              <Link to="/app/loans/apply/group" className="button secondary">
                Group application
              </Link>
              <Link to="/app/loans/apply" className="button primary">
                New application
              </Link>
            </>
          ) : null}
        </>
      }
    >
      {error ? <p className="loans-field-error loans-animate-in">{error}</p> : null}

      <div className="loans-filter-row loans-animate-in loans-animate-in--2">
        <label className="field loans-filter">
          <span>Filter by status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | LoanApplicationStatus)}
          >
            <option value="">All statuses</option>
            {(Object.keys(LOAN_STATUS_LABELS) as LoanApplicationStatus[]).map((status) => (
              <option key={status} value={status}>
                {LOAN_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="field loans-filter">
          <span>Filter by type</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as "" | LoanType)}>
            <option value="">All types</option>
            <option value="individual">Individual</option>
            <option value="group_solidarity">Group solidarity</option>
          </select>
        </label>
      </div>

      <section className="card loans-animate-in loans-animate-in--3">
        <AdminDataTable
          columns={[
            {
              key: "customer",
              label: "Customer",
              render: (row) => (
                <Link to={`/app/loans/applications/${row.id}`} className="loans-row-link">
                  <strong>{customerDisplayName(row.customerName)}</strong>
                </Link>
              )
            },
            { key: "product", label: "Product", render: (row) => row.productName ?? "—" },
            {
              key: "type",
              label: "Type",
              render: (row) => loanTypeLabel(row.loanType)
            },
            {
              key: "group",
              label: "Group",
              render: (row) => row.groupName ?? "—"
            },
            {
              key: "principal",
              label: "Principal",
              render: (row) => formatLoanMoney(row.principalAmount)
            },
            {
              key: "installment",
              label: "Installment",
              render: (row) =>
                row.installmentAmount != null
                  ? `${formatLoanMoney(row.installmentAmount)} / ${frequencyLabel(row.repaymentFrequency).toLowerCase()}`
                  : "—"
            },
            {
              key: "outstanding",
              label: "Outstanding",
              render: (row) =>
                row.status === "disbursed" || row.status === "closed" ? (
                  formatLoanMoney(row.outstandingPrincipal)
                ) : (
                  <span className="muted">—</span>
                )
            },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <span className={`status-pill status-pill--${LOAN_STATUS_PILL[row.status]}`}>
                  {LOAN_STATUS_LABELS[row.status]}
                </span>
              )
            },
            { key: "applied", label: "Applied", render: (row) => formatLoanDateTime(row.appliedAt) }
          ]}
          rows={filtered}
          rowKey={(row) => row.id}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search customer, product, notes…"
          emptyMessage={loading && !applications.length ? "Loading applications…" : "No loan applications yet."}
          actions={(row) => (
            <Link to={`/app/loans/applications/${row.id}`} className="button link">
              Open
            </Link>
          )}
        />
      </section>
    </LoansLayout>
  );
}
