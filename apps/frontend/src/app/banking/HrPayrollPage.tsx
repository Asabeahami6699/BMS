import { StaffPayrollSection } from "../StaffPayrollSection";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";

type Props = { displayName?: string };

export function HrPayrollPage({ displayName }: Props) {
  const config = getRoleDeskConfig("hrm");
  return (
    <RoleDeskShell
      config={{ ...config, title: "Payroll", subtitle: "Monthly payroll runs, payslips, and role defaults." }}
      displayName={displayName}
    >
      <StaffPayrollSection />
    </RoleDeskShell>
  );
}
