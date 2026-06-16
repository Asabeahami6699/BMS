import { useAccountantDeskStore } from "./stores/accountantDeskStore";
import { useAgencyStore } from "./stores/agencyStore";
import { useAgencyTellerStore } from "./stores/agencyTellerStore";
import { useAgentsStore } from "./stores/agentsStore";
import { useAuditorDeskStore } from "./stores/auditorDeskStore";
import { useBackOfficeStore } from "./stores/backOfficeStore";
import { useBankProductsStore } from "./stores/bankProductsStore";
import { useBranchCounterStore } from "./stores/branchCounterStore";
import { useCommissionStore } from "./stores/commissionStore";
import { useCoordinatorStore } from "./stores/coordinatorStore";
import { useCoordinatorsStore } from "./stores/coordinatorsStore";
import { useCustomersStore } from "./stores/customersStore";
import { useGroupSavingsStore } from "./stores/groupSavingsStore";
import { useHrDeskStore } from "./stores/hrDeskStore";
import { useInvestmentStore } from "./stores/investmentStore";
import { useLoansStore } from "./stores/loansStore";
import { usePayrollStore } from "./stores/payrollStore";
import { usePerformanceStore } from "./stores/performanceStore";
import { useReportsAnalyticsStore } from "./stores/reportsAnalyticsStore";
import { useRoleWorkspaceStore } from "./stores/roleWorkspaceStore";
import { useRoutesStore } from "./stores/routesStore";
import { useTellerReconciliationStore } from "./stores/tellerReconciliationStore";
import { useTreasuryStore } from "./stores/treasuryStore";
import { useUniversalOpsStore } from "./stores/universalOpsStore";
import { useWithdrawalsStore } from "./stores/withdrawalsStore";

function appPath(pathname: string): string {
  return pathname.replace(/^\/app\/?/, "") || "dashboard";
}

function any(...flags: boolean[]): boolean {
  return flags.some(Boolean);
}

function roleDeskLoading(): boolean {
  const s = useRoleWorkspaceStore.getState();
  return s.loading || s.busyId !== null;
}

function backOfficeLoading(): boolean {
  const s = useBackOfficeStore.getState();
  return s.loading || s.busyId !== null;
}

function branchCounterLoading(): boolean {
  const s = useBranchCounterStore.getState();
  return s.loading || s.refreshing || s.statementLoading || s.ledgerLoading;
}

function universalOpsLoading(path: string): boolean {
  const s = useUniversalOpsStore.getState();
  if (s.actionBusy) {
    return true;
  }
  if (path === "operations") {
    return s.summaryLoading;
  }
  if (path.startsWith("operations/attendance")) {
    return s.attendanceLoading;
  }
  if (path.startsWith("operations/leave")) {
    return s.leaveLoading;
  }
  if (path.startsWith("operations/staff-loans")) {
    return s.loansLoading;
  }
  if (path.startsWith("operations/announcements")) {
    return s.announcementsLoading;
  }
  if (path.startsWith("operations/documents")) {
    return s.documentsLoading;
  }
  if (path.startsWith("operations/incidents")) {
    return s.incidentsLoading;
  }
  return any(
    s.summaryLoading,
    s.attendanceLoading,
    s.leaveLoading,
    s.loansLoading,
    s.announcementsLoading,
    s.documentsLoading,
    s.incidentsLoading
  );
}

function hrDeskLoading(path: string): boolean {
  const s = useHrDeskStore.getState();
  if (path.includes("/attendance")) {
    return s.attendanceLoading;
  }
  if (path.includes("/leave")) {
    return s.leaveLoading;
  }
  if (path.includes("/training")) {
    return s.trainingLoading;
  }
  if (path.includes("/staff-loans")) {
    return s.staffLoansLoading;
  }
  if (path.includes("/policies")) {
    return s.policiesLoading;
  }
  if (path.includes("/profiles") || path.includes("/branches") || path === "banking/hrm") {
    return s.rosterLoading;
  }
  return any(
    s.rosterLoading,
    s.leaveLoading,
    s.attendanceLoading,
    s.trainingLoading,
    s.staffLoansLoading,
    s.policiesLoading
  );
}

function accountantDeskLoading(path: string): boolean {
  const s = useAccountantDeskStore.getState();
  if (path.includes("trial-balance")) {
    return s.trialLoading;
  }
  return s.dashboardLoading;
}

function auditorDeskLoading(path: string): boolean {
  const s = useAuditorDeskStore.getState();
  if (path.includes("exceptions")) {
    return s.exceptionsLoading;
  }
  return s.dashboardLoading;
}

function investmentLoading(path: string): boolean {
  const s = useInvestmentStore.getState();
  if (path.includes("reports")) {
    return s.reportsLoading;
  }
  return s.loading;
}

export function computeDashboardPageLoading(pathname: string): boolean {
  const path = appPath(pathname);

  if (path === "dashboard" || path === "susu/overview") {
    return any(
      useCoordinatorStore.getState().loading,
      usePerformanceStore.getState().loading,
      useWithdrawalsStore.getState().loading,
      useGroupSavingsStore.getState().loading
    );
  }

  if (path === "susu/pending-approvals") {
    return useCoordinatorStore.getState().loading;
  }

  if (path === "susu/customers" || path === "susu/onboarding") {
    return useCustomersStore.getState().loading;
  }

  if (path === "susu/collections") {
    return branchCounterLoading();
  }

  if (path === "susu/commissions") {
    return useCommissionStore.getState().loading;
  }

  if (path === "susu/payroll") {
    const s = usePayrollStore.getState();
    return s.loading || s.refreshing;
  }

  if (path === "susu/agents") {
    return useAgentsStore.getState().loading;
  }

  if (path === "susu/coordinators") {
    return useCoordinatorsStore.getState().loading;
  }

  if (path === "susu/routes") {
    return useRoutesStore.getState().loading;
  }

  if (path === "susu/withdrawals") {
    return useWithdrawalsStore.getState().loading;
  }

  if (path === "susu/group-savings") {
    return useGroupSavingsStore.getState().loading;
  }

  if (path === "susu/performance") {
    return usePerformanceStore.getState().loading;
  }

  if (path === "reports" || path.includes("/reports")) {
    return useReportsAnalyticsStore.getState().loading;
  }

  if (path.startsWith("operations")) {
    return universalOpsLoading(path);
  }

  if (path === "banking" || path === "banking/") {
    return useAgencyStore.getState().loading;
  }

  if (path === "banking/deposits") {
    const s = useAgencyTellerStore.getState();
    return s.loading || s.depositsLoading;
  }

  if (path === "banking/reconciliation") {
    return useTellerReconciliationStore.getState().loading;
  }

  if (path === "banking/products") {
    return useBankProductsStore.getState().loading;
  }

  if (path.startsWith("banking/hrm")) {
    return hrDeskLoading(path);
  }

  if (path.startsWith("banking/accountant")) {
    return accountantDeskLoading(path);
  }

  if (path.startsWith("banking/auditor")) {
    return auditorDeskLoading(path);
  }

  if (path === "banking/back-office" || path.startsWith("banking/back-office/")) {
    return backOfficeLoading();
  }

  if (
    path === "banking/teller" ||
    path.startsWith("banking/teller/") ||
    path === "banking/customer-service" ||
    path.startsWith("banking/customer-service/") ||
    path.startsWith("banking/withdrawals")
  ) {
    return roleDeskLoading();
  }

  if (path.startsWith("banking/")) {
    return any(useAgencyStore.getState().loading, roleDeskLoading(), backOfficeLoading());
  }

  if (path.startsWith("loans")) {
    return useLoansStore.getState().loading;
  }

  if (path.startsWith("investments")) {
    return investmentLoading(path);
  }

  if (path.startsWith("treasury")) {
    const s = useTreasuryStore.getState();
    return s.loading || s.posting;
  }

  return false;
}

type StoreLike = {
  subscribe: (listener: () => void) => () => void;
};

const WATCHED_STORES: StoreLike[] = [
  useCoordinatorStore,
  usePerformanceStore,
  useWithdrawalsStore,
  useGroupSavingsStore,
  useReportsAnalyticsStore,
  useAgentsStore,
  useCoordinatorsStore,
  useRoutesStore,
  useCustomersStore,
  useCommissionStore,
  usePayrollStore,
  useBranchCounterStore,
  useAgencyStore,
  useRoleWorkspaceStore,
  useBackOfficeStore,
  useAgencyTellerStore,
  useTellerReconciliationStore,
  useAccountantDeskStore,
  useAuditorDeskStore,
  useHrDeskStore,
  useUniversalOpsStore,
  useLoansStore,
  useInvestmentStore,
  useTreasuryStore,
  useBankProductsStore
];

export function initDashboardPageLoadingSubscriptions(recompute: () => void): () => void {
  const unsubs = WATCHED_STORES.map((store) => store.subscribe(recompute));
  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}
