import { useEffect, useState } from "react";
import type { HrStaffLoan } from "@bms/shared";
import { useShallow } from "zustand/react/shallow";
import { AdminDataTable } from "../../../components/AdminDataTable";
import { useToast } from "../../../components/Toast";
import { useHrDeskStore } from "../../stores/hrDeskStore";
import { HrSectionShell } from "./HrSectionShell";
import { StaffLoanApprovalModal } from "./StaffLoanApprovalModal";

type Props = { displayName?: string; canManage: boolean };

function formatMoney(value?: number | null): string {
  if (value == null) {
    return "—";
  }
  return `GHS ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function HrStaffLoansPage({ displayName, canManage }: Props) {
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [approvalLoan, setApprovalLoan] = useState<HrStaffLoan | null>(null);
  const [approving, setApproving] = useState(false);
  const {
    loans,
    loading,
    error,
    lastFetchedAt,
    hydrateStaffLoans,
    refreshStaffLoans,
    setStaffLoanStatus,
    startLiveSync,
    stopLiveSync
  } = useHrDeskStore(
    useShallow((s) => ({
      loans: s.staffLoans,
      loading: s.staffLoansLoading,
      error: s.staffLoansError,
      lastFetchedAt: s.lastStaffLoansAt,
      hydrateStaffLoans: s.hydrateStaffLoans,
      refreshStaffLoans: s.refreshStaffLoans,
      setStaffLoanStatus: s.setStaffLoanStatus,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  useEffect(() => {
    hydrateStaffLoans({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrateStaffLoans, startLiveSync, stopLiveSync]);

  async function handleApprove(monthlyDeduction: number) {
    if (!approvalLoan) {
      return;
    }
    setApproving(true);
    try {
      await setStaffLoanStatus(approvalLoan.id, "approved", { monthlyDeduction });
      showToast("Loan approved", "success");
      setApprovalLoan(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setApproving(false);
    }
  }

  async function handleDecline() {
    if (!approvalLoan) {
      return;
    }
    setApproving(true);
    try {
      await setStaffLoanStatus(approvalLoan.id, "declined");
      showToast("Loan declined", "success");
      setApprovalLoan(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setApproving(false);
    }
  }

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  return (
    <>
      <HrSectionShell
        title="Staff loans"
        subtitle="Review loan applications, calculate monthly deductions, and approve payroll recovery."
        displayName={displayName}
        loading={loading && loans.length === 0}
        error={error}
        updatedLabel={updatedLabel}
        onRefresh={() => void refreshStaffLoans()}
        refreshing={loading}
      >
        <AdminDataTable
          variant="desk"
          title="Loan applications"
          subtitle="Pending and active staff loans across the organisation."
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search employee or purpose…"
          columns={[
            { key: "employee", label: "Employee" },
            { key: "amount", label: "Amount" },
            { key: "purpose", label: "Purpose" },
            { key: "term", label: "Term" },
            { key: "monthly", label: "Monthly" },
            { key: "status", label: "Status" }
          ]}
          rows={loans.map((l) => ({
            id: l.id,
            employee: l.userName ?? l.userId,
            amount: formatMoney(l.amount),
            purpose: l.purpose,
            term: `${l.termMonths} mo`,
            monthly: formatMoney(l.monthlyDeduction),
            status: l.status,
            raw: l
          }))}
          rowKey={(r) => r.id}
          emptyMessage={loading ? "Loading…" : "No staff loan applications."}
          actions={
            canManage
              ? (row) =>
                  row.raw.status === "pending" ? (
                    <div className="role-workspace__queue-actions">
                      <button type="button" className="btn primary" onClick={() => setApprovalLoan(row.raw)}>
                        Review
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() =>
                          void setStaffLoanStatus(row.id, "declined").catch((err) =>
                            showToast(err instanceof Error ? err.message : "Failed", "error")
                          )
                        }
                      >
                        Decline
                      </button>
                    </div>
                  ) : null
              : undefined
          }
        />
      </HrSectionShell>

      <StaffLoanApprovalModal
        open={Boolean(approvalLoan)}
        loan={approvalLoan}
        busy={approving}
        onClose={() => setApprovalLoan(null)}
        onApprove={(monthlyDeduction) => void handleApprove(monthlyDeduction)}
        onDecline={() => void handleDecline()}
      />
    </>
  );
}
