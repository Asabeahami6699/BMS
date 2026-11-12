import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppRole, LoanBorrowerRow } from "../api";
import { AdminDataTable, filterRowsBySearch } from "../../components/AdminDataTable";
import { useToast } from "../../components/Toast";
import { formatLoanMoney, LOAN_STATUS_LABELS, LOAN_STATUS_PILL } from "./loanUi";
import { LoansLayout } from "./LoansLayout";
import { usePageLoading } from "../hooks/usePageLoading";
import { useLoanCustomersStore } from "../stores/loanCustomersStore";

type Props = { role: AppRole };

export function LoanCustomersPage({ role: _role }: Props) {
  const { showToast } = useToast();
  const rows = useLoanCustomersStore((s) => s.rows);
  const loading = useLoanCustomersStore((s) => s.loading);
  const error = useLoanCustomersStore((s) => s.error);
  const hydrate = useLoanCustomersStore((s) => s.hydrate);
  const refresh = useLoanCustomersStore((s) => s.refresh);
  const startLiveSync = useLoanCustomersStore((s) => s.startLiveSync);
  const stopLiveSync = useLoanCustomersStore((s) => s.stopLiveSync);
  const [search, setSearch] = useState("");

  usePageLoading(loading, "loan-customers");

  useEffect(() => {
    hydrate();
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync]);

  useEffect(() => {
    if (error) {
      showToast(error, "error");
    }
  }, [error, showToast]);

  const filtered = useMemo(
    () =>
      filterRowsBySearch(rows, search, [
        "fullName",
        "phone",
        "accountNumber",
        "location",
        "accountStatus",
        "latestLoanStatus"
      ] as (keyof LoanBorrowerRow)[]),
    [rows, search]
  );

  return (
    <LoansLayout
      activeNav="customers"
      title="Loan customers"
      subtitle="Borrowers with loan applications — not the full Susu customer book."
      actions={
        <button type="button" className="button secondary" disabled={loading} onClick={() => void refresh()}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      <section className="card">
        <AdminDataTable
          columns={[
            {
              key: "name",
              label: "Borrower",
              render: (row) => (
                <div className="customers-table-name">
                  <strong>{row.fullName}</strong>
                  <small>{row.phone || "—"}</small>
                </div>
              )
            },
            {
              key: "account",
              label: "Account",
              render: (row) => row.accountNumber ?? "—"
            },
            {
              key: "loans",
              label: "Loans",
              render: (row) => (
                <div>
                  <span>{row.loanCount}</span>
                  <small className="customers-table-sub">{row.activeLoanCount} active</small>
                </div>
              )
            },
            {
              key: "outstanding",
              label: "Outstanding",
              render: (row) => formatLoanMoney(row.totalOutstanding)
            },
            {
              key: "latest",
              label: "Latest loan",
              render: (row) => (
                <span className={`status-pill status-pill--${LOAN_STATUS_PILL[row.latestLoanStatus]}`}>
                  {LOAN_STATUS_LABELS[row.latestLoanStatus]}
                </span>
              )
            },
            {
              key: "open",
              label: "",
              render: (row) => (
                <Link className="button secondary" to={`/app/loans/applications/${row.latestLoanId}`}>
                  Open loan
                </Link>
              )
            }
          ]}
          rows={filtered}
          rowKey={(row) => row.customerId}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search borrower, phone, account…"
          emptyMessage={loading ? "Loading loan customers…" : "No loan customers yet."}
        />
      </section>
    </LoansLayout>
  );
}
