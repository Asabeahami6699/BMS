import { useEffect } from "react";
import { ALL_BRANCHES_SCOPE, BRANCH_CONTEXT_CHANGED_EVENT } from "../api";
import { useAgencyStore } from "../stores/agencyStore";
import { useAgentsStore } from "../stores/agentsStore";
import { useBankProductsStore } from "../stores/bankProductsStore";
import { useBranchCounterStore } from "../stores/branchCounterStore";
import { useCoordinatorsStore } from "../stores/coordinatorsStore";
import { useCoordinatorStore } from "../stores/coordinatorStore";
import { useCustomersStore } from "../stores/customersStore";
import { useGroupSavingsStore } from "../stores/groupSavingsStore";
import { useLoansStore } from "../stores/loansStore";
import { usePerformanceStore } from "../stores/performanceStore";
import { useReportsAnalyticsStore } from "../stores/reportsAnalyticsStore";
import { useTreasuryStore } from "../stores/treasuryStore";
import { useWithdrawalsStore } from "../stores/withdrawalsStore";

function refreshBranchScopedStores(): void {
  void useCustomersStore.getState().refresh();
  void useBranchCounterStore.getState().refresh();
  void useTreasuryStore.getState().refreshSilent();
  void useAgencyStore.getState().refresh();
  void useWithdrawalsStore.getState().refresh();
  void useGroupSavingsStore.getState().refresh();
  void useReportsAnalyticsStore.getState().refresh();
  void useCoordinatorsStore.getState().refresh();
  void useAgentsStore.getState().refresh();
  void usePerformanceStore.getState().refresh();
  void useCoordinatorStore.getState().refresh();
  void useLoansStore.getState().refresh();
  useBankProductsStore.getState().syncBranchContextFromNav();
}

/** Refetch tenant data when the nav bar branch context changes. */
export function useBranchContextSync(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handler = () => refreshBranchScopedStores();
    window.addEventListener(BRANCH_CONTEXT_CHANGED_EVENT, handler);
    return () => window.removeEventListener(BRANCH_CONTEXT_CHANGED_EVENT, handler);
  }, [enabled]);
}

export { ALL_BRANCHES_SCOPE, refreshBranchScopedStores };
