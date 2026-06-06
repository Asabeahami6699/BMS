import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { hasTenantModule, type TenantProductModule } from "@bms/shared";
import { useAuth } from "../auth/AuthContext";
import { buildTenantNav } from "../config/tenantModules";
import type { AppRole, AuthMe, Branch } from "./api";
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
import { LoansPermissionGate } from "./loans/LoansPermissionGate";
import { LoanDetailPage } from "./LoanDetailPage";
import { TransactionLedgerCard } from "./TransactionLedgerCard";
import { UserManagementCard } from "./UserManagementCard";
import { getRuntimeBranchId, listBranches, setRuntimeBranchId } from "./api";
import { FieldAgentApp } from "../agent/FieldAgentApp";
import { OverviewPage } from "./OverviewPage";
import { TenantDashboardPage } from "./TenantDashboardPage";
import { PendingApprovalsCard } from "./PendingApprovalsCard";
import { PendingBalanceApprovalsCard } from "./PendingBalanceApprovalsCard";

const ONBOARDING_WORKFLOW = [
  "Field Agent → Customer Registration",
  "Pending Approval",
  "Coordinator Review",
  "Active Customer"
];

export function TenantApp() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const role = (user?.role ?? "admin") as AppRole;
  const [selectedBranch, setSelectedBranch] = useState(getRuntimeBranchId());
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    if (!user?.userId || role === "field_agent") {
      return;
    }
    if (user.branchId) {
      setSelectedBranch(user.branchId);
      setRuntimeBranchId(user.branchId);
    }
    void listBranches()
      .then((tenantBranches) => {
        setBranches(tenantBranches);
        if (!user.branchId && tenantBranches.length > 0) {
          setSelectedBranch(tenantBranches[0].id);
          setRuntimeBranchId(tenantBranches[0].id);
        }
      })
      .catch(() => setBranches([]));
  }, [user?.userId, user?.branchId, role]);

  const modules = user?.subscribedModules;
  const addons = user?.subscribedAddons;
  const reportsAnalytics = user?.reportsAnalytics !== false;

  const isAdminLike = role === "admin" || role === "accountant" || role === "auditor";
  const isCoordinatorLike = role === "coordinator" || role === "admin";
  const canOperateTransactions =
    role === "admin" || role === "field_agent" || role === "coordinator" || role === "teller";

  const showBranchSelector = Boolean(user?.scopeType === "head_office");
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
    reportsAnalytics !== false &&
    (role === "admin" ||
      role === "coordinator" ||
      role === "accountant" ||
      role === "auditor" ||
      role === "teller");

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  function AccessDenied() {
    return (
      <article className="card">
        <h2>Access Restricted</h2>
        <p className="muted">This page is not available for your role.</p>
      </article>
    );
  }

  function ModuleGate({ module, children }: { module: TenantProductModule; children: ReactNode }) {
    if (!hasTenantModule(modules, module)) {
      return (
        <article className="card">
          <h2>Product not enabled</h2>
          <p className="muted">This department is not on your company subscription.</p>
        </article>
      );
    }
    return <>{children}</>;
  }

  function LoansRoute({ route, children }: { route: string; children: ReactNode }) {
    return (
      <ModuleGate module="loans_credit">
        <LoansPermissionGate permissions={permissions} route={route} denied={<AccessDenied />}>
          {children}
        </LoansPermissionGate>
      </ModuleGate>
    );
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
          <label className="field dash-topbar-field">
            <span>Active Branch Context</span>
            <select
              value={selectedBranch}
              onChange={(e) => {
                setSelectedBranch(e.target.value);
                setRuntimeBranchId(e.target.value);
              }}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </label>
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
            <ModuleGate module="susu_management">
              <OverviewPage
                role={role}
                modules={modules}
                reportsAnalytics={reportsAnalytics}
                isAdminLike={isAdminLike}
                isCoordinatorLike={isCoordinatorLike}
                me={user}
                branches={branches}
                displayName={displayName}
              />
            </ModuleGate>
          }
        />
        <Route
          path="/susu/customers"
          element={
            <ModuleGate module="susu_management">
              {role === "admin" || role === "coordinator" ? (
                <CustomerOpsCard role={role} />
              ) : (
                <AccessDenied />
              )}
            </ModuleGate>
          }
        />
        <Route
          path="/susu/pending-approvals"
          element={
            <ModuleGate module="susu_management">
              {role === "admin" || role === "coordinator" ? (
                <>
                  <PendingBalanceApprovalsCard />
                  <PendingApprovalsCard />
                </>
              ) : (
                <AccessDenied />
              )}
            </ModuleGate>
          }
        />
        <Route
          path="/susu/callover-batches"
          element={
            <ModuleGate module="susu_management">
              {role === "admin" || role === "coordinator" ? (
                <CalloverBatchesPage role={role} />
              ) : (
                <AccessDenied />
              )}
            </ModuleGate>
          }
        />
        <Route
          path="/susu/till-float"
          element={
            <ModuleGate module="susu_management">
              {role === "admin" || role === "coordinator" ? (
                <BranchFloatAdminPage role={role} />
              ) : (
                <AccessDenied />
              )}
            </ModuleGate>
          }
        />
        <Route
          path="/susu/collections"
          element={
            <ModuleGate module="susu_management">
              {canOperateTransactions ? <BranchCounterCard role={role} /> : <AccessDenied />}
            </ModuleGate>
          }
        />
        <Route
          path="/susu/commissions"
          element={
            <ModuleGate module="susu_management">
              <CommissionPolicyCard role={role} />
            </ModuleGate>
          }
        />
        <Route
          path="/susu/payroll"
          element={
            <ModuleGate module="susu_management">
              <PayslipCard role={role} />
            </ModuleGate>
          }
        />
        <Route
          path="/susu/agents"
          element={
            <ModuleGate module="susu_management">
              {role === "admin" || role === "coordinator" ? (
                <FieldAgentsPage role={role} />
              ) : (
                <AccessDenied />
              )}
            </ModuleGate>
          }
        />
        <Route
          path="/susu/coordinators"
          element={
            <ModuleGate module="susu_management">
              {role === "admin" ? <CoordinatorsPage /> : <AccessDenied />}
            </ModuleGate>
          }
        />
        <Route
          path="/susu/routes"
          element={
            <ModuleGate module="susu_management">
              {role === "admin" || role === "coordinator" ? (
                <RoutesPage role={role} />
              ) : (
                <AccessDenied />
              )}
            </ModuleGate>
          }
        />
        <Route
          path="/susu/withdrawals"
          element={
            <ModuleGate module="susu_management">
              {role === "admin" || role === "coordinator" ? (
                <WithdrawalsPage role={role} />
              ) : (
                <AccessDenied />
              )}
            </ModuleGate>
          }
        />
        <Route
          path="/susu/group-savings"
          element={
            <ModuleGate module="susu_management">
              {role === "admin" || role === "coordinator" ? (
                <GroupSavingsPage role={role} />
              ) : (
                <AccessDenied />
              )}
            </ModuleGate>
          }
        />
        <Route
          path="/susu/performance"
          element={
            <ModuleGate module="susu_management">
              <PerformancePage role={role} />
            </ModuleGate>
          }
        />
        <Route path="/susu/reports" element={<Navigate to="/app/reports" replace />} />
        <Route
          path="/susu/onboarding"
          element={
            <ModuleGate module="susu_management">
              <FeaturePlaceholderPage
                title="Customer Onboarding"
                description="Registration form: personal info, Ghana Card, address, account type, opening balance, assigned agent. Default status: Pending Approval."
                workflow={ONBOARDING_WORKFLOW}
              />
            </ModuleGate>
          }
        />

        {/* Other departments */}
        <Route path="/banking" element={<ModuleGate module="banking"><ModulePlaceholderCard module="banking" /></ModuleGate>} />
        <Route path="/loans" element={<LoansRoute route="loans"><LoansOverviewPage role={role} /></LoansRoute>} />
        <Route
          path="/loans/products"
          element={<LoansRoute route="loans/products"><LoanProductsPage role={role} /></LoansRoute>}
        />
        <Route
          path="/loans/applications"
          element={<LoansRoute route="loans/applications"><LoanApplicationsPage role={role} /></LoansRoute>}
        />
        <Route
          path="/loans/applications/:loanId"
          element={
            <LoansRoute route="loans/applications/detail">
              <LoanDetailPage role={role} />
            </LoansRoute>
          }
        />
        <Route
          path="/loans/groups"
          element={<LoansRoute route="loans/groups"><LoanGroupsPage role={role} /></LoansRoute>}
        />
        <Route
          path="/loans/apply/group"
          element={<LoansRoute route="loans/apply/group"><LoanGroupApplyWizard role={role} /></LoansRoute>}
        />
        <Route path="/loans/apply" element={<LoansRoute route="loans/apply"><LoanApplyWizard role={role} /></LoansRoute>} />
        <Route
          path="/loans/form"
          element={
            <LoansRoute route="loans/form">
              <LoanBlankFormPage role={role} companyName={user?.tenantName} />
            </LoansRoute>
          }
        />
        <Route path="/treasury" element={<ModuleGate module="treasury"><ModulePlaceholderCard module="treasury" /></ModuleGate>} />

        {/* Settings */}
        <Route
          path="/settings"
          element={
            role === "admin" ? (
              <SettingsHubPage />
            ) : (
              <AccessDenied />
            )
          }
        />
        <Route
          path="/settings/profile"
          element={
            role === "admin" ? (
              <FeaturePlaceholderPage title="Company Profile" description="Company name, logo, contact, address, tax, and branding." />
            ) : (
              <AccessDenied />
            )
          }
        />
        <Route
          path="/settings/subscription"
          element={
            role === "admin" ? (
              <SettingsSubscriptionPage
                subscribedModules={modules}
                subscribedAddons={addons}
                reportsAnalytics={reportsAnalytics}
              />
            ) : (
              <AccessDenied />
            )
          }
        />
        <Route path="/settings/add-ons" element={<Navigate to="/settings/subscription" replace />} />
        <Route
          path="/settings/branches"
          element={role === "admin" ? <BranchManagementCard role={role} /> : <AccessDenied />}
        />
        <Route
          path="/settings/account-numbers"
          element={role === "admin" ? <AccountNumberPolicyCard role={role} /> : <AccessDenied />}
        />
        <Route
          path="/settings/users"
          element={role === "admin" ? <UserManagementCard role={role} /> : <AccessDenied />}
        />
        <Route
          path="/settings/roles"
          element={role === "admin" ? <RoleManagementPage role={role} /> : <AccessDenied />}
        />
        <Route
          path="/settings/approval-workflows"
          element={
            role === "admin" ? (
              <FeaturePlaceholderPage
                title="Approval Workflows"
                description="Configure customer and withdrawal approval chains."
                workflow={ONBOARDING_WORKFLOW}
              />
            ) : (
              <AccessDenied />
            )
          }
        />
        <Route
          path="/settings/notifications"
          element={
            role === "admin" ? <SettingsNotificationsPage subscribedAddons={addons} /> : <AccessDenied />
          }
        />
        <Route
          path="/settings/audit-logs"
          element={
            role === "admin" || role === "auditor" ? <AuditLogsPage /> : <AccessDenied />
          }
        />

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
