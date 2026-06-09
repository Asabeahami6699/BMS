import { create } from "zustand";
import type { CreateCashMovementInput, TreasuryBootstrap } from "@bms/shared";
import {
  getActiveBranchFilter,
  getTenantId,
  getTreasuryBootstrap,
  isTreasuryAllBranchesBootstrap,
  postCashMovement,
  type TreasuryAllBranchesBootstrap
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type TreasuryState = {
  branchId: string | null;
  bootstrap: TreasuryBootstrap | null;
  allBranches: TreasuryAllBranchesBootstrap["branches"] | null;
  loading: boolean;
  posting: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;

  setBranchId: (branchId: string) => void;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  postMovement: (payload: CreateCashMovementInput) => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

export const useTreasuryStore = create<TreasuryState>((set, get) => ({
  branchId: getActiveBranchFilter() ?? null,
  bootstrap: null,
  allBranches: null,
  loading: false,
  posting: false,
  error: null,
  lastFetchedAt: null,
  liveSyncActive: false,

  setBranchId: (branchId) => {
    set({ branchId, bootstrap: null, allBranches: null, lastFetchedAt: null });
    void get().refresh();
  },

  hydrate: (options) => {
    const { loading, lastFetchedAt } = get();
    runHydrate({
      force: options?.force,
      loading,
      lastFetchedAt,
      refresh: () => get().refresh(),
      refreshSilent: () => get().refreshSilent(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
  },

  refresh: async () => {
    const branchId = get().branchId ?? getActiveBranchFilter() ?? undefined;
    if (fetchInFlight) {
      return fetchInFlight;
    }
    set({ loading: true, error: null, branchId: branchId ?? null });
    fetchInFlight = (async () => {
      try {
        const response = await getTreasuryBootstrap(branchId);
        if (isTreasuryAllBranchesBootstrap(response)) {
          set({
            allBranches: response.branches,
            bootstrap: null,
            loading: false,
            lastFetchedAt: Date.now(),
            error: null
          });
        } else {
          set({
            bootstrap: response,
            allBranches: null,
            loading: false,
            lastFetchedAt: Date.now(),
            error: null
          });
        }
      } catch (error) {
        set({
          loading: false,
          error: toUserFacingError(error, "Could not load treasury data")
        });
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  refreshSilent: async () => {
    if (fetchInFlight) {
      return fetchInFlight;
    }
    const branchId = get().branchId ?? getActiveBranchFilter() ?? undefined;
    fetchInFlight = (async () => {
      try {
        const response = await getTreasuryBootstrap(branchId);
        if (isTreasuryAllBranchesBootstrap(response)) {
          set({ allBranches: response.branches, bootstrap: null, lastFetchedAt: Date.now(), error: null });
        } else {
          set({ bootstrap: response, allBranches: null, lastFetchedAt: Date.now(), error: null });
        }
      } catch {
        /* keep stale data */
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  postMovement: async (payload) => {
    set({ posting: true, error: null });
    try {
      const bootstrap = await postCashMovement(payload);
      set({ bootstrap, allBranches: null, posting: false, lastFetchedAt: Date.now() });
    } catch (error) {
      set({
        posting: false,
        error: toUserFacingError(error, "Could not record cash movement")
      });
      throw error;
    }
  },

  startLiveSync: () => {
    if (get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: ["branch_cash_accounts", "cash_movements"],
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt)
    });
  },

  stopLiveSync: () => {
    if (!get().liveSyncActive) {
      return;
    }
    liveSync.stop();
    set({ liveSyncActive: false });
  }
}));
