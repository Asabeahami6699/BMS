import { create } from "zustand";
import type { AccountantDashboard, TreasuryBootstrap } from "@bms/shared";
import { getAccountantDashboard, getAccountantTrialBalance, getTenantId } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

const DESK_STALE_MS = 30_000;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

export type BranchTrialBalance = {
  branchId: string;
  branchName: string;
  branchCode?: string;
  bootstrap: TreasuryBootstrap;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

type State = {
  branchId: string;
  trialBranchId: string;
  trialDateFrom: string;
  trialDateTo: string;
  dashboard: AccountantDashboard | null;
  trialSingle: TreasuryBootstrap | null;
  trialBranches: BranchTrialBalance[];
  dashboardLoading: boolean;
  trialLoading: boolean;
  error: string | null;
  trialError: string | null;
  lastDashboardAt: number | null;
  lastTrialAt: number | null;
  liveSyncActive: boolean;

  hydrateDashboard: (options?: { force?: boolean; branchId?: string }) => void;
  refreshDashboard: () => Promise<void>;
  refreshDashboardSilent: () => Promise<void>;
  setTrialBranchId: (branchId: string) => void;
  setTrialDateRange: (dateFrom: string, dateTo: string) => void;
  hydrateTrialBalance: (options?: { force?: boolean; branchId?: string }) => void;
  refreshTrialBalance: () => Promise<void>;
  refreshTrialBalanceSilent: () => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let dashboardFetch: Promise<void> | null = null;
let trialFetch: Promise<void> | null = null;

function isDeskFresh(at: number | null): boolean {
  return isFresh(at, DESK_STALE_MS);
}

export const useAccountantDeskStore = create<State>((set, get) => ({
  branchId: "all",
  trialBranchId: "all",
  trialDateFrom: daysAgoIso(30),
  trialDateTo: todayIso(),
  dashboard: null,
  trialSingle: null,
  trialBranches: [],
  dashboardLoading: false,
  trialLoading: false,
  error: null,
  trialError: null,
  lastDashboardAt: null,
  lastTrialAt: null,
  liveSyncActive: false,

  hydrateDashboard: (options) => {
    if (options?.branchId) {
      set({ branchId: options.branchId });
    }
    const { dashboardLoading, lastDashboardAt } = get();
    runHydrate({
      force: options?.force,
      loading: dashboardLoading,
      lastFetchedAt: lastDashboardAt,
      refresh: () => get().refreshDashboard(),
      refreshSilent: () => get().refreshDashboardSilent(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
  },

  refreshDashboard: async () => {
    if (dashboardFetch) {
      return dashboardFetch;
    }
    const { branchId } = get();
    set({ dashboardLoading: true, error: null });
    dashboardFetch = (async () => {
      try {
        const dashboard = await getAccountantDashboard({
          branchId: branchId || "all"
        });
        set({ dashboard, lastDashboardAt: Date.now(), error: null });
      } catch (error) {
        set({ error: toUserFacingError(error, "Could not load accountant dashboard") });
      } finally {
        set({ dashboardLoading: false });
        dashboardFetch = null;
      }
    })();
    return dashboardFetch;
  },

  refreshDashboardSilent: async () => {
    if (dashboardFetch) {
      return dashboardFetch;
    }
    const { branchId } = get();
    dashboardFetch = (async () => {
      try {
        const dashboard = await getAccountantDashboard({
          branchId: branchId || "all"
        });
        set({ dashboard, lastDashboardAt: Date.now(), error: null });
      } catch {
        /* keep stale */
      } finally {
        dashboardFetch = null;
      }
    })();
    return dashboardFetch;
  },

  setTrialBranchId: (branchId) => {
    if (get().trialBranchId === branchId) {
      return;
    }
    set({ trialBranchId: branchId, lastTrialAt: null });
    void get().refreshTrialBalance();
  },

  setTrialDateRange: (dateFrom, dateTo) => {
    if (get().trialDateFrom === dateFrom && get().trialDateTo === dateTo) {
      return;
    }
    set({ trialDateFrom: dateFrom, trialDateTo: dateTo, lastTrialAt: null });
    void get().refreshTrialBalance();
  },

  hydrateTrialBalance: (options) => {
    if (options?.branchId) {
      set({ trialBranchId: options.branchId });
    }
    const { trialLoading, lastTrialAt } = get();
    runHydrate({
      force: options?.force,
      loading: trialLoading,
      lastFetchedAt: lastTrialAt,
      refresh: () => get().refreshTrialBalance(),
      refreshSilent: () => get().refreshTrialBalanceSilent(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
  },

  refreshTrialBalance: async () => {
    if (trialFetch) {
      return trialFetch;
    }
    const { trialBranchId, trialDateFrom, trialDateTo } = get();
    set({ trialLoading: true, trialError: null });
    trialFetch = (async () => {
      try {
        const data = await getAccountantTrialBalance({
          branchId: trialBranchId && trialBranchId !== "all" ? trialBranchId : "all",
          dateFrom: trialDateFrom,
          dateTo: trialDateTo
        });
        if ("branches" in data && Array.isArray(data.branches)) {
          set({
            trialBranches: data.branches as BranchTrialBalance[],
            trialSingle: null,
            lastTrialAt: Date.now(),
            trialError: null
          });
        } else {
          set({
            trialSingle: data as TreasuryBootstrap,
            trialBranches: [],
            lastTrialAt: Date.now(),
            trialError: null
          });
        }
      } catch (error) {
        set({ trialError: toUserFacingError(error, "Could not load trial balance") });
      } finally {
        set({ trialLoading: false });
        trialFetch = null;
      }
    })();
    return trialFetch;
  },

  refreshTrialBalanceSilent: async () => {
    if (trialFetch) {
      return trialFetch;
    }
    const { trialBranchId, trialDateFrom, trialDateTo } = get();
    trialFetch = (async () => {
      try {
        const data = await getAccountantTrialBalance({
          branchId: trialBranchId && trialBranchId !== "all" ? trialBranchId : "all",
          dateFrom: trialDateFrom,
          dateTo: trialDateTo
        });
        if ("branches" in data && Array.isArray(data.branches)) {
          set({
            trialBranches: data.branches as BranchTrialBalance[],
            trialSingle: null,
            lastTrialAt: Date.now(),
            trialError: null
          });
        } else {
          set({
            trialSingle: data as TreasuryBootstrap,
            trialBranches: [],
            lastTrialAt: Date.now(),
            trialError: null
          });
        }
      } catch {
        /* keep stale */
      } finally {
        trialFetch = null;
      }
    })();
    return trialFetch;
  },

  startLiveSync: () => {
    const state = get();
    if (state.liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: ["transactions", "agency_deposits", "treasury_cash_accounts"],
      onRefresh: () => {
        void get().refreshDashboardSilent();
        void get().refreshTrialBalanceSilent();
      },
      isStale: () => !isDeskFresh(get().lastDashboardAt)
    });
  },

  stopLiveSync: () => {
    if (!get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: false });
    liveSync.stop();
  }
}));
