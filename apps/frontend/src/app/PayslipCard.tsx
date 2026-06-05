import { useEffect, useMemo } from "react";
import type { AppRole } from "./api";
import { useShallow } from "zustand/react/shallow";
import { PayslipViewer } from "./PayslipViewer";
import { StaffPayrollSection } from "./StaffPayrollSection";
import { usePayrollStore } from "./stores/payrollStore";

type Props = {
  role: AppRole;
};

const COMMISSION_ROLES = new Set<AppRole>(["field_agent", "coordinator"]);
const PAYROLL_ADMIN_ROLES = new Set<AppRole>(["admin", "accountant"]);

export function PayslipCard({ role }: Props) {
  const canManagePayroll = PAYROLL_ADMIN_ROLES.has(role);
  const hasCommission = useMemo(() => COMMISSION_ROLES.has(role), [role]);

  const { myPayslips, loading, hydrate, startLiveSync, stopLiveSync } = usePayrollStore(
    useShallow((s) => ({
      myPayslips: s.myPayslips,
      loading: s.loading,
      hydrate: s.hydrate,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  useEffect(() => {
    if (canManagePayroll) {
      return;
    }
    hydrate();
    startLiveSync();
    return () => stopLiveSync();
  }, [canManagePayroll, hydrate, startLiveSync, stopLiveSync]);

  const latest = myPayslips[0];
  const status =
    loading && myPayslips.length === 0
      ? "Loading payslip…"
      : latest
        ? ""
        : "No official payslip yet. HR publishes payslips after each payroll run.";

  if (canManagePayroll) {
    return (
      <div className="agents-page payroll-page">
        <StaffPayrollSection />
        <section className="payroll-panel payroll-panel--compact">
          <h3>Your payslip preview</h3>
          {latest ? (
            <PayslipViewer payslip={latest} subtitle="Your account after the last payroll run" />
          ) : (
            <p className="muted">{status}</p>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="agents-page payroll-page">
      <section className="payroll-panel">
        <header className="agents-page__header payroll-workspace__header">
          <div>
            <h2>My payslip</h2>
            <p className="muted">
              {hasCommission
                ? "Earnings, commissions, and deductions from your role template and collections."
                : "Take-home pay after role-based deductions."}
            </p>
          </div>
        </header>
        {latest ? (
          <PayslipViewer payslip={latest} subtitle="Published payslip" />
        ) : (
          <p className="muted">{status}</p>
        )}
      </section>
    </div>
  );
}
