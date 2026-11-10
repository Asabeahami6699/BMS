import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppRole, LoanBorrowerRow } from "../api";
import { listLoanBorrowers } from "../api";
import { AdminDataTable, filterRowsBySearch } from "../../components/AdminDataTable";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import { formatLoanMoney, LOAN_STATUS_LABELS, LOAN_STATUS_PILL } from "./loanUi";
import { LoansLayout } from "./LoansLayout";
import { usePageLoading } from "../hooks/usePageLoading";

type Props = { role: AppRole };

export function LoanCustomersPage({ role: _role }: Props) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<LoanBorrowerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  usePageLoading(loading, "loan-customers");

  async function refresh() {
    setLoading(true);
    try {
      setRows(await listLoanBorrowers());
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to load loan customers"), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
