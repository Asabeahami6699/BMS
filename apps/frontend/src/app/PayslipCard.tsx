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
      <div className="payroll-page">
        <StaffPayrollSection />
      </div>
    );
  }

  return (
    <div className="payroll-modern-page">
      <header className="overview-hero payroll-modern-hero">
        <div>
          <p className="overview-hero__eyebrow">Compensation</p>
          <h1 className="overview-hero__title">My payslip</h1>
          <p className="overview-hero__sub muted">
            {hasCommission
              ? "Earnings, collection commissions, and deductions from your role template."
              : "Take-home pay after role-based deductions."}
          </p>
        </div>
      </header>

      <section className="overview-panel statements-section">
        {latest ? (
          <PayslipViewer payslip={latest} subtitle="Published payslip" />
        ) : (
          <div className="statements-ledger-empty">
            <p className="muted">{status}</p>
          </div>
        )}
      </section>
    </div>
  );
}
