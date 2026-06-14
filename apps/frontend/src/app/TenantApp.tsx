import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { hasAnyPermission } from "@bms/shared";
import { useAuth } from "../auth/AuthContext";
import { buildTenantNav } from "../config/tenantModules";
import type { AppRole, AuthMe } from "./api";
import { BranchManagementCard } from "./BranchManagementCard";
import { AccountNumberPolicyCard } from "./AccountNumberPolicyCard";
import { CommissionPolicyCard } from "./CommissionPolicyCard";
import { CustomerOpsCard } from "./CustomerOpsCard";
import { DashboardShell } from "./DashboardShell";
import { FeaturePlaceholderPage } from "./FeaturePlaceholderPage";
import { ModulePlaceholderCard } from "./ModulePlaceholderCard";
import { PayslipCard } from "./PayslipCard";
import { ReportsAnalyticsPage } from "./ReportsAnalyticsPage";
import { UserProfilePage } from "./UserProfilePage";
import { RoleManagementPage } from "./RoleManagementPage";
import { AuditLogsPage } from "./AuditLogsPage";
import { SettingsNotificationsPage } from "./settings/SettingsAddonsPage";
import { SettingsSubscriptionPage } from "./settings/SettingsSubscriptionPage";
import { SettingsHubPage } from "./SettingsHubPage";
import { FieldAgentsPage } from "./FieldAgentsPage";
import { CoordinatorsPage } from "./CoordinatorsPage";
import { RoutesPage } from "./RoutesPage";
import { WithdrawalsPage } from "./WithdrawalsPage";
import { GroupSavingsPage } from "./GroupSavingsPage";
import { PerformancePage } from "./PerformancePage";
import { BranchCounterCard } from "./BranchCounterCard";
import { BranchFloatAdminPage } from "./BranchFloatAdminPage";
import { CalloverBatchesPage } from "./CalloverBatchesPage";
import { LoansOverviewPage } from "./LoansOverviewPage";
import { LoanProductsPage } from "./LoanProductsPage";
import { LoanApplicationsPage } from "./LoanApplicationsPage";
import { LoanApplyWizard } from "./loans/LoanApplyWizard";
import { LoanGroupApplyWizard } from "./loans/LoanGroupApplyWizard";
import { LoanBlankFormPage } from "./loans/LoanBlankFormPage";
import { LoanGroupsPage } from "./LoanGroupsPage";
import { LoanDetailPage } from "./LoanDetailPage";
import { InvestmentsOverviewPage } from "./investments/InvestmentsOverviewPage";
import { InvestmentApplicationsPage } from "./investments/InvestmentApplicationsPage";
import { InvestmentApplyPage } from "./investments/InvestmentApplyPage";
import { InvestmentProductsPage } from "./investments/InvestmentProductsPage";
import { InvestmentFormBuilderPage } from "./investments/InvestmentFormBuilderPage";
import { InvestmentReportsPage } from "./investments/InvestmentReportsPage";
import { InvestmentDetailPage } from "./investments/InvestmentDetailPage";
import { TransactionLedgerCard } from "./TransactionLedgerCard";
import { UserManagementCard } from "./UserManagementCard";
import {
  AccessDenied,
  TenantAgencyRoute,
  TenantBankingRoute,
  TenantInvestmentsRoute,
  TenantLoansRoute,
  TenantSettingsRoute,
  TenantSusuRoute,
  TenantTreasuryRoute
} from "./tenantRouteGates";
import { TreasuryPage } from "./TreasuryPage";
import { AgencyDepositsPage } from "./banking/AgencyDepositsPage";
import { AgencyAccountOpeningPage } from "./banking/AgencyAccountOpeningPage";
import { AgencyInitiateWithdrawalPage } from "./banking/AgencyInitiateWithdrawalPage";
import { AgencyWithdrawalsPage } from "./banking/AgencyWithdrawalsPage";
import { BackOfficeDeskPage } from "./banking/BackOfficeDeskPage";
import { CustomerServiceDeskPage } from "./banking/CustomerServiceDeskPage";
import { RoleDeskRoute } from "./banking/RoleDeskRoute";
import { AccountantApprovalsPage } from "./banking/AccountantApprovalsPage";
import { AccountantDeskPage } from "./banking/AccountantDeskPage";
import { AuditorDeskPage } from "./banking/AuditorDeskPage";
import { AuditorExceptionsPage } from "./banking/AuditorExceptionsPage";
import { HrDeskPage } from "./banking/HrDeskPage";
import { HrPayrollPage } from "./banking/HrPayrollPage";
import { HrRolesPage } from "./banking/HrRolesPage";
import { HrStaffDirectoryPage } from "./banking/HrStaffDirectoryPage";
import { AccountantTrialBalancePage } from "./banking/AccountantTrialBalancePage";
import { HrAttendancePage } from "./banking/hr/HrAttendancePage";
import { HrAppointmentPage } from "./banking/hr/HrAppointmentPage";
import { HrBranchAssignmentsPage } from "./banking/hr/HrBranchAssignmentsPage";
import { HrLeavePage } from "./banking/hr/HrLeavePage";
import { HrTrainingPage } from "./banking/hr/HrTrainingPage";
import { HrStaffLoansPage } from "./banking/hr/HrStaffLoansPage";
import { HrPoliciesPage } from "./banking/hr/HrPoliciesPage";
import { RolePlaceholderDeskPage } from "./banking/RolePlaceholderDeskPage";
import { TellerDeskPage } from "./banking/TellerDeskPage";
import { TellerReconciliationPage } from "./banking/TellerReconciliationPage";
import { TellerTillDaybookPage } from "./banking/TellerTillDaybookPage";
import { UniversalOpsAnnouncementsPage } from "./universal/UniversalOpsAnnouncementsPage";
import { UniversalOpsAttendancePage } from "./universal/UniversalOpsAttendancePage";
import { UniversalOpsDashboardPage } from "./universal/UniversalOpsDashboardPage";
import { UniversalOpsDocumentsPage } from "./universal/UniversalOpsDocumentsPage";
import { UniversalOpsIncidentsPage } from "./universal/UniversalOpsIncidentsPage";
import { UniversalOpsLeavePage } from "./universal/UniversalOpsLeavePage";
import { UniversalOpsStaffLoansPage } from "./universal/UniversalOpsStaffLoansPage";
import { BankProductsPage } from "./BankProductsPage";
import { BankingOverviewPage } from "./BankingOverviewPage";
import { useBranchesLiveSync } from "./hooks/useBranchesLiveSync";
import { useBranchesStore } from "./stores/branchesStore";
import { ALL_BRANCHES_SCOPE, getRuntimeBranchId, setRuntimeBranchId } from "./api";
import { useBranchContextSync } from "./hooks/useBranchContextSync";
import { FieldAgentApp } from "../agent/FieldAgentApp";
import { OverviewPage } from "./OverviewPage";
import { TenantDashboardPage } from "./TenantDashboardPage";
import { PendingApprovalsCard } from "./PendingApprovalsCard";
import { PendingBalanceApprovalsCard } from "./PendingBalanceApprovalsCard";
import { CustomerOnboardingPage } from "./CustomerOnboardingPage";
import { SusuClosingBalancesPage } from "./SusuClosingBalancesPage";

const APPROVAL_WORKFLOW_STEPS = [
  "Field agent registration or withdrawal request",
  "Coordinator review",
  "Customer account credited or debited",
  "Callover batch posted to ledger"
];

export function TenantApp() {
  const { user, logout, refreshMe } = useAuth();
  const navigate = useNavigate();
  const role = (user?.role ?? "admin") as AppRole;
  const [selectedBranch, setSelectedBranch] = useState(getRuntimeBranchId());
  const branches = useBranchesStore(useShallow((s) => s.branches));

  useBranchesLiveSync();

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const showBranchSelector = Boolean(user?.scopeType === "head_office");
  useBranchContextSync(showBranchSelector);

  useEffect(() => {
    if (!user?.userId || role === "field_agent") {
      return;
    }
    if (user.scopeType === "branch" && user.branchId) {
      setSelectedBranch(user.branchId);
      setRuntimeBranchId(user.branchId);
      return;
    }
    const stored = getRuntimeBranchId();
    setSelectedBranch(stored || ALL_BRANCHES_SCOPE);
  }, [user?.userId, user?.branchId, user?.scopeType, role]);

  const modules = user?.subscribedModules;
  const addons = user?.subscribedAddons;
  const reportsAnalytics = user?.reportsAnalytics !== false;

  const activeBranchFilter = selectedBranch === ALL_BRANCHES_SCOPE ? undefined : selectedBranch;
  const displayName = user?.fullName ?? user?.email?.split("@")[0] ?? role;

  const permissions = user?.permissions;

  const navItems = useMemo(
    () => buildTenantNav(role, modules, addons, reportsAnalytics, permissions, user?.susuNavVisibility),
    [role, modules, addons, reportsAnalytics, permissions, user?.susuNavVisibility]
  );

  const canSearchCustomers = Boolean(permissions?.includes("customers.read"));
  const canSearchUsers = Boolean(permissions?.includes("users.read"));
  const notificationsEnabled = Boolean(
    permissions?.includes("workspace.notifications") || permissions?.includes("customers.read")
  );
  const canReports =
    reportsAnalytics !== false && hasAnyPermission(permissions, ["reports.read"]);
  const canMoveTreasuryCash = hasAnyPermission(permissions, ["treasury.cash.move"]);
  const canManageHr = hasAnyPermission(permissions, ["users.update"]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const companyName = user?.tenantName ?? user?.tenantId ?? undefined;

  if (role === "field_agent") {
    return (
      <Routes>
        <Route path="/agent/*" element={<FieldAgentApp />} />
        <Route path="*" element={<Navigate to="/app/agent/home" replace />} />
      </Routes>
    );
  }

  return (
    <DashboardShell
      workspaceSubtitle="Department operations for your cooperative."
      navItems={navItems}
      companyName={companyName}
      userName={displayName}
      userRole={role.replace(/_/g, " ")}
      canSearchCustomers={canSearchCustomers}
      canSearchUsers={canSearchUsers}
      notificationsEnabled={notificationsEnabled}
      onLogout={handleLogout}
      topbarActions={
        showBranchSelector ? (
          <div className="dash-header-branch">
            <label className="dash-header-branch__label" htmlFor="active-branch-context">
              Branch context
            </label>
            <select
              id="active-branch-context"
              className="dash-header-branch__select"
              value={selectedBranch || ALL_BRANCHES_SCOPE}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedBranch(next);
                setRuntimeBranchId(next);
              }}
            >
              <option value={ALL_BRANCHES_SCOPE}>All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>
        ) : undefined
      }
    >
      <Routes>
        <Route path="/" element={<Navigate to="dashboard" replace />} />
        <Route
          path="/dashboard"
          element={
            <TenantDashboardPage
              role={role}
              modules={modules}
              permissions={permissions}
              me={user}
              branches={branches}
              displayName={displayName}
            />
          }
        />
        <Route path="/overview" element={<Navigate to="/app/dashboard" replace />} />

        {/* Universal Operations — all staff */}
        <Route path="/operations" element={<UniversalOpsDashboardPage displayName={displayName} />} />
        <Route path="/operations/attendance" element={<UniversalOpsAttendancePage displayName={displayName} />} />
        <Route path="/operations/leave" element={<UniversalOpsLeavePage displayName={displayName} />} />
        <Route path="/operations/staff-loans" element={<UniversalOpsStaffLoansPage displayName={displayName} />} />
        <Route
          path="/operations/announcements"
          element={<UniversalOpsAnnouncementsPage displayName={displayName} />}
        />
        <Route path="/operations/documents" element={<UniversalOpsDocumentsPage displayName={displayName} />} />
        <Route path="/operations/incidents" element={<UniversalOpsIncidentsPage displayName={displayName} />} />
        <Route
          path="/profile"
          element={<UserProfilePage me={user} branches={branches} role={role} />}
        />

        <Route
          path="/reports"
          element={
            canReports ? (
              <ReportsAnalyticsPage role={role} me={user} />
            ) : reportsAnalytics === false ? (
              <ReportsAnalyticsPage role={role} me={user} />
            ) : (
              <AccessDenied />
            )
          }
        />

        {/* Susu Management */}
        <Route path="/susu/dashboard" element={<Navigate to="/app/susu/overview" replace />} />
        <Route
          path="/susu/overview"
          element={
            <TenantSusuRoute route="susu/overview" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}>
              <OverviewPage
                role={role}
                modules={modules}
                reportsAnalytics={reportsAnalytics}
                isAdminLike={hasAnyPermission(permissions, ["users.read", "roles.read"])}
                isCoordinatorLike={hasAnyPermission(permissions, ["customers.create", "branch_float.manage"])}
                me={user}
                branches={branches}
                displayName={displayName}
              />
            </TenantSusuRoute>
          }
        />
        <Route path="/susu/customers" element={<TenantSusuRoute route="susu/customers" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}><CustomerOpsCard role={role} /></TenantSusuRoute>} />
        <Route
          path="/susu/pending-approvals"
          element={
            <TenantSusuRoute route="susu/pending-approvals" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}>
              <PendingBalanceApprovalsCard />
              <PendingApprovalsCard />
            </TenantSusuRoute>
          }
        />
        <Route path="/susu/callover-batches" element={<TenantSusuRoute route="susu/callover-batches" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}><CalloverBatchesPage role={role} /></TenantSusuRoute>} />
        <Route path="/susu/till-float" element={<TenantSusuRoute route="susu/till-float" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}><BranchFloatAdminPage role={role} /></TenantSusuRoute>} />
        <Route path="/susu/collections" element={<TenantSusuRoute route="susu/collections" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}><BranchCounterCard role={role} /></TenantSusuRoute>} />
        <Route path="/susu/commissions" element={<TenantSusuRoute route="susu/commissions" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}><CommissionPolicyCard role={role} /></TenantSusuRoute>} />
        <Route path="/susu/payroll" element={<TenantSusuRoute route="susu/payroll" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}><PayslipCard role={role} /></TenantSusuRoute>} />
        <Route path="/susu/agents" element={<TenantSusuRoute route="susu/agents" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}><FieldAgentsPage role={role} /></TenantSusuRoute>} />
        <Route path="/susu/coordinators" element={<TenantSusuRoute route="susu/coordinators" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}><CoordinatorsPage /></TenantSusuRoute>} />
        <Route path="/susu/routes" element={<TenantSusuRoute route="susu/routes" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}><RoutesPage role={role} /></TenantSusuRoute>} />
        <Route path="/susu/withdrawals" element={<TenantSusuRoute route="susu/withdrawals" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}><WithdrawalsPage role={role} permissions={permissions} /></TenantSusuRoute>} />
        <Route path="/susu/group-savings" element={<TenantSusuRoute route="susu/group-savings" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}><GroupSavingsPage role={role} /></TenantSusuRoute>} />
        <Route path="/susu/performance" element={<TenantSusuRoute route="susu/performance" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}><PerformancePage role={role} /></TenantSusuRoute>} />
        <Route path="/susu/reports" element={<Navigate to="/app/reports" replace />} />
        <Route
          path="/susu/onboarding"
          element={
            <TenantSusuRoute route="susu/onboarding" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}>
              <CustomerOnboardingPage role={role} />
            </TenantSusuRoute>
          }
        />
        <Route
          path="/susu/closing-balances"
          element={
            <TenantSusuRoute route="susu/closing-balances" modules={modules} role={role} permissions={permissions} susuNavVisibility={user?.susuNavVisibility}>
              <SusuClosingBalancesPage role={role} />
            </TenantSusuRoute>
          }
        />

        {/* Agency banking */}
        <Route path="/banking" element={<TenantBankingRoute route="banking" modules={modules} permissions={permissions}><BankingOverviewPage role={role} permissions={permissions} /></TenantBankingRoute>} />
        <Route
          path="/banking/teller"
          element={
            <TenantAgencyRoute route="banking/teller" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="teller" role={role} permissions={permissions}>
                <TellerDeskPage displayName={displayName} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/deposits"
          element={
            <TenantAgencyRoute route="banking/deposits" modules={modules} permissions={permissions}>
              <AgencyDepositsPage />
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/reconciliation"
          element={
            <TenantAgencyRoute route="banking/reconciliation" modules={modules} permissions={permissions}>
              <TellerReconciliationPage />
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/till-daybook"
          element={
            <TenantAgencyRoute route="banking/till-daybook" modules={modules} permissions={permissions}>
              <TellerTillDaybookPage />
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/customer-service"
          element={
            <TenantAgencyRoute route="banking/customer-service" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="customer_service" role={role} permissions={permissions}>
                <CustomerServiceDeskPage displayName={displayName} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/withdrawals/initiate"
          element={
            <TenantAgencyRoute route="banking/withdrawals" modules={modules} permissions={permissions}>
              <AgencyInitiateWithdrawalPage />
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/withdrawals"
          element={
            <TenantAgencyRoute route="banking/withdrawals" modules={modules} permissions={permissions}>
              <AgencyWithdrawalsPage role={role} permissions={permissions} />
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/account-opening"
          element={
            <TenantAgencyRoute route="banking/account-opening" modules={modules} permissions={permissions}>
              <AgencyAccountOpeningPage />
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/back-office"
          element={
            <TenantAgencyRoute route="banking/back-office" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="back_officer" role={role} permissions={permissions}>
                <BackOfficeDeskPage displayName={displayName} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/back-office/deposits"
          element={<Navigate to="/app/banking/back-office#deposits" replace />}
        />
        <Route
          path="/banking/back-office/balancing"
          element={<Navigate to="/app/banking/back-office#balancing" replace />}
        />
        <Route
          path="/banking/back-office/reconciliation"
          element={<Navigate to="/app/banking/back-office#reconciliation" replace />}
        />
        <Route
          path="/banking/accountant"
          element={
            <TenantAgencyRoute route="banking/accountant" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="accountant" role={role} permissions={permissions}>
                <AccountantDeskPage displayName={displayName} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/accountant/approvals"
          element={
            <TenantAgencyRoute route="banking/accountant/approvals" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="accountant" role={role} permissions={permissions}>
                <AccountantApprovalsPage displayName={displayName} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/accountant/reports"
          element={
            <TenantAgencyRoute route="banking/accountant/reports" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="accountant" role={role} permissions={permissions}>
                <ReportsAnalyticsPage role={role} me={user} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/accountant/trial-balance"
          element={
            <TenantAgencyRoute route="banking/accountant/trial-balance" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="accountant" role={role} permissions={permissions}>
                <AccountantTrialBalancePage displayName={displayName} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/auditor"
          element={
            <TenantAgencyRoute route="banking/auditor" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="auditor" role={role} permissions={permissions}>
                <AuditorDeskPage displayName={displayName} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/auditor/logs"
          element={
            <TenantAgencyRoute route="banking/auditor/logs" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="auditor" role={role} permissions={permissions}>
                <AuditLogsPage />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/auditor/reports"
          element={
            <TenantAgencyRoute route="banking/auditor/reports" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="auditor" role={role} permissions={permissions}>
                <ReportsAnalyticsPage role={role} me={user} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/auditor/exceptions"
          element={
            <TenantAgencyRoute route="banking/auditor/exceptions" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="auditor" role={role} permissions={permissions}>
                <AuditorExceptionsPage displayName={displayName} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/hrm"
          element={
            <TenantAgencyRoute route="banking/hrm" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="hrm" role={role} permissions={permissions}>
                <HrDeskPage displayName={displayName} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route path="/banking/hrm/staff" element={<Navigate to="/app/banking/hrm/profiles" replace />} />
        <Route
          path="/banking/hrm/profiles"
          element={
            <TenantAgencyRoute route="banking/hrm/profiles" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="hrm" role={role} permissions={permissions}>
                <HrStaffDirectoryPage displayName={displayName} role={role} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/hrm/branches"
          element={
            <TenantAgencyRoute route="banking/hrm/branches" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="hrm" role={role} permissions={permissions}>
                <HrBranchAssignmentsPage displayName={displayName} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/hrm/attendance"
          element={
            <TenantAgencyRoute route="banking/hrm/attendance" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="hrm" role={role} permissions={permissions}>
                <HrAttendancePage displayName={displayName} canManage={canManageHr} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/hrm/leave"
          element={
            <TenantAgencyRoute route="banking/hrm/leave" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="hrm" role={role} permissions={permissions}>
                <HrLeavePage displayName={displayName} canManage={canManageHr} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/hrm/appointments"
          element={
            <TenantAgencyRoute route="banking/hrm/appointments" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="hrm" role={role} permissions={permissions}>
                <HrAppointmentPage displayName={displayName} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/hrm/training"
          element={
            <TenantAgencyRoute route="banking/hrm/training" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="hrm" role={role} permissions={permissions}>
                <HrTrainingPage displayName={displayName} canManage={canManageHr} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/hrm/payroll"
          element={
            <TenantAgencyRoute route="banking/hrm/payroll" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="hrm" role={role} permissions={permissions}>
                <HrPayrollPage displayName={displayName} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/hrm/staff-loans"
          element={
            <TenantAgencyRoute route="banking/hrm/staff-loans" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="hrm" role={role} permissions={permissions}>
                <HrStaffLoansPage displayName={displayName} canManage={canManageHr} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/hrm/policies"
          element={
            <TenantAgencyRoute route="banking/hrm/policies" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="hrm" role={role} permissions={permissions}>
                <HrPoliciesPage displayName={displayName} canManage={canManageHr} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/hrm/roles"
          element={
            <TenantAgencyRoute route="banking/hrm/roles" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="hrm" role={role} permissions={permissions}>
                <HrRolesPage displayName={displayName} role={role} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route
          path="/banking/operations"
          element={
            <TenantAgencyRoute route="banking/operations" modules={modules} permissions={permissions}>
              <RoleDeskRoute kind="operations" role={role} permissions={permissions}>
                <RolePlaceholderDeskPage kind="operations" displayName={displayName} />
              </RoleDeskRoute>
            </TenantAgencyRoute>
          }
        />
        <Route path="/banking/products" element={<TenantAgencyRoute route="banking/products" modules={modules} permissions={permissions}><BankProductsPage role={role} permissions={permissions} /></TenantAgencyRoute>} />
        <Route path="/banking/teller-payouts" element={<Navigate to="/app/banking/teller" replace />} />
        <Route path="/workspace/teller" element={<Navigate to="/app/banking/teller" replace />} />
        <Route path="/workspace/customer-service" element={<Navigate to="/app/banking/customer-service" replace />} />
        <Route path="/workspace/back-office" element={<Navigate to="/app/banking/back-office" replace />} />
        <Route path="/workspace/accountant" element={<Navigate to="/app/banking/accountant" replace />} />
        <Route path="/workspace/auditor" element={<Navigate to="/app/banking/auditor" replace />} />
        <Route path="/workspace/hrm" element={<Navigate to="/app/banking/hrm" replace />} />
        <Route path="/workspace/operations" element={<Navigate to="/app/banking/operations" replace />} />

        {/* Other departments */}
        <Route path="/loans" element={<TenantLoansRoute route="loans" modules={modules} permissions={permissions}><LoansOverviewPage role={role} /></TenantLoansRoute>} />
        <Route
          path="/loans/products"
          element={<TenantLoansRoute route="loans/products" modules={modules} permissions={permissions}><LoanProductsPage role={role} /></TenantLoansRoute>}
        />
        <Route
          path="/loans/applications"
          element={<TenantLoansRoute route="loans/applications" modules={modules} permissions={permissions}><LoanApplicationsPage role={role} /></TenantLoansRoute>}
        />
        <Route
          path="/loans/applications/:loanId"
          element={
            <TenantLoansRoute route="loans/applications/detail" modules={modules} permissions={permissions}>
              <LoanDetailPage role={role} />
            </TenantLoansRoute>
          }
        />
        <Route
          path="/loans/groups"
          element={<TenantLoansRoute route="loans/groups" modules={modules} permissions={permissions}><LoanGroupsPage role={role} /></TenantLoansRoute>}
        />
        <Route
          path="/loans/apply/group"
          element={<TenantLoansRoute route="loans/apply/group" modules={modules} permissions={permissions}><LoanGroupApplyWizard role={role} /></TenantLoansRoute>}
        />
        <Route path="/loans/apply" element={<TenantLoansRoute route="loans/apply" modules={modules} permissions={permissions}><LoanApplyWizard role={role} /></TenantLoansRoute>} />
        <Route
          path="/loans/form"
          element={
            <TenantLoansRoute route="loans/form" modules={modules} permissions={permissions}>
              <LoanBlankFormPage role={role} companyName={user?.tenantName} />
            </TenantLoansRoute>
          }
        />
        <Route
          path="/investments"
          element={
            <TenantInvestmentsRoute route="investments" modules={modules} permissions={permissions}>
              <InvestmentsOverviewPage role={role} />
            </TenantInvestmentsRoute>
          }
        />
        <Route
          path="/investments/applications"
          element={
            <TenantInvestmentsRoute route="investments/applications" modules={modules} permissions={permissions}>
              <InvestmentApplicationsPage role={role} />
            </TenantInvestmentsRoute>
          }
        />
        <Route
          path="/investments/applications/:investmentId"
          element={
            <TenantInvestmentsRoute route="investments/applications/detail" modules={modules} permissions={permissions}>
              <InvestmentDetailPage role={role} />
            </TenantInvestmentsRoute>
          }
        />
        <Route
          path="/investments/apply"
          element={
            <TenantInvestmentsRoute route="investments/apply" modules={modules} permissions={permissions}>
              <InvestmentApplyPage role={role} />
            </TenantInvestmentsRoute>
          }
        />
        <Route
          path="/investments/products"
          element={
            <TenantInvestmentsRoute route="investments/products" modules={modules} permissions={permissions}>
              <InvestmentProductsPage role={role} />
            </TenantInvestmentsRoute>
          }
        />
        <Route
          path="/investments/form-builder"
          element={
            <TenantInvestmentsRoute route="investments/form-builder" modules={modules} permissions={permissions}>
              <InvestmentFormBuilderPage role={role} />
            </TenantInvestmentsRoute>
          }
        />
        <Route
          path="/investments/reports"
          element={
            <TenantInvestmentsRoute route="investments/reports" modules={modules} permissions={permissions}>
              <InvestmentReportsPage role={role} />
            </TenantInvestmentsRoute>
          }
        />
        <Route
          path="/treasury"
          element={
            <TenantTreasuryRoute route="treasury" modules={modules} permissions={permissions}>
              <TreasuryPage canMoveCash={canMoveTreasuryCash} defaultBranchId={activeBranchFilter} />
            </TenantTreasuryRoute>
          }
        />
        <Route
          path="/treasury/movements"
          element={
            <TenantTreasuryRoute route="treasury/movements" modules={modules} permissions={permissions}>
              <TreasuryPage canMoveCash={canMoveTreasuryCash} defaultBranchId={activeBranchFilter} />
            </TenantTreasuryRoute>
          }
        />
        <Route
          path="/treasury/trial-balance"
          element={<Navigate to="/app/banking/accountant/trial-balance" replace />}
        />

        {/* Settings */}
        <Route path="/settings" element={<TenantSettingsRoute route="settings" role={role} permissions={permissions}><SettingsHubPage /></TenantSettingsRoute>} />
        <Route
          path="/settings/profile"
          element={
            <TenantSettingsRoute route="settings/profile" role={role} permissions={permissions}>
              <FeaturePlaceholderPage title="Company Profile" description="Company name, logo, contact, address, tax, and branding." />
            </TenantSettingsRoute>
          }
        />
        <Route
          path="/settings/subscription"
          element={
            <TenantSettingsRoute route="settings/subscription" role={role} permissions={permissions}>
              <SettingsSubscriptionPage
                subscribedModules={modules}
                subscribedAddons={addons}
                reportsAnalytics={reportsAnalytics}
              />
            </TenantSettingsRoute>
          }
        />
        <Route path="/settings/add-ons" element={<Navigate to="/settings/subscription" replace />} />
        <Route path="/settings/branches" element={<TenantSettingsRoute route="settings/branches" role={role} permissions={permissions}><BranchManagementCard role={role} /></TenantSettingsRoute>} />
        <Route path="/settings/account-numbers" element={<TenantSettingsRoute route="settings/account-numbers" role={role} permissions={permissions}><AccountNumberPolicyCard role={role} /></TenantSettingsRoute>} />
        <Route path="/settings/users" element={<TenantSettingsRoute route="settings/users" role={role} permissions={permissions}><UserManagementCard role={role} /></TenantSettingsRoute>} />
        <Route path="/settings/roles" element={<TenantSettingsRoute route="settings/roles" role={role} permissions={permissions}><RoleManagementPage role={role} /></TenantSettingsRoute>} />
        <Route
          path="/settings/approval-workflows"
          element={
            <TenantSettingsRoute route="settings/approval-workflows" role={role} permissions={permissions}>
              <FeaturePlaceholderPage
                title="Approval Workflows"
                description="Configure customer and withdrawal approval chains."
                workflow={APPROVAL_WORKFLOW_STEPS}
              />
            </TenantSettingsRoute>
          }
        />
        <Route
          path="/settings/notifications"
          element={
            <TenantSettingsRoute route="settings/notifications" role={role} permissions={permissions}>
              <SettingsNotificationsPage subscribedAddons={addons} />
            </TenantSettingsRoute>
          }
        />
        <Route path="/settings/audit-logs" element={<TenantSettingsRoute route="settings/audit-logs" role={role} permissions={permissions}><AuditLogsPage /></TenantSettingsRoute>} />

        {/* Legacy redirects */}
        <Route path="/core-banking" element={<Navigate to="banking" replace />} />
        <Route path="/fixed-deposits" element={<Navigate to="treasury" replace />} />
        <Route path="/mobile-money" element={<Navigate to="settings/subscription" replace />} />
        <Route path="/branches" element={<Navigate to="settings/branches" replace />} />
        <Route path="/users" element={<Navigate to="settings/users" replace />} />
        <Route path="/roles" element={<Navigate to="settings/roles" replace />} />
        <Route path="/customers" element={<Navigate to="susu/customers" replace />} />
        <Route path="/transactions" element={<Navigate to="susu/collections" replace />} />
        <Route path="/commission" element={<Navigate to="susu/commissions" replace />} />
        <Route path="/payroll" element={<Navigate to="susu/payroll" replace />} />
        <Route path="/susu/commission" element={<Navigate to="susu/commissions" replace />} />

        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </DashboardShell>
  );
}
