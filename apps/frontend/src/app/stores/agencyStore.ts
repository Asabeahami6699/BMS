import { create } from "zustand";
import type { AgencyBootstrap } from "@bms/shared";
import {
  executeAgencyBankDeposit,
  executeAgencyBankWithdrawal,
  getActiveBranchFilter,
  getAgencyBootstrap,
  getTenantId,
  tellerPayAgencyWithdrawal
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type AgencyState = {
  branchId: string | null;
  bootstrap: AgencyBootstrap | null;
  loading: boolean;
  busyId: string | null;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;

  setBranchId: (branchId: string) => void;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  executeDeposit: (transactionId: string) => Promise<void>;
  executeWithdrawal: (disclosureId: string, bankProductId?: string) => Promise<void>;
  payWithdrawal: (disclosureId: string) => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

export const useAgencyStore = create<AgencyState>((set, get) => ({
  branchId: getActiveBranchFilter() ?? null,
  bootstrap: null,
  loading: false,
  busyId: null,
  error: null,
  lastFetchedAt: null,
  liveSyncActive: false,

  setBranchId: (branchId) => {
    set({ branchId, bootstrap: null, lastFetchedAt: null });
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
    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        const bootstrap = await getAgencyBootstrap(branchId);
        set({ bootstrap, loading: false, lastFetchedAt: Date.now(), error: null });
      } catch (error) {
        set({ loading: false, error: toUserFacingError(error, "Could not load agency queues") });
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  refreshSilent: async () => {
    const branchId = get().branchId ?? getActiveBranchFilter() ?? undefined;
    if (fetchInFlight) {
      return fetchInFlight;
    }
    fetchInFlight = (async () => {
      try {
        const bootstrap = await getAgencyBootstrap(branchId);
        set({ bootstrap, lastFetchedAt: Date.now(), error: null });
      } catch {
        // Keep stale queue data on silent refresh failure
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  executeDeposit: async (transactionId) => {
    set({ busyId: transactionId, error: null });
    try {
      await executeAgencyBankDeposit(transactionId);
      await get().refresh();
    } catch (error) {
      set({ error: toUserFacingError(error, "Bank execution failed") });
      throw error;
    } finally {
      set({ busyId: null });
    }
  },

  executeWithdrawal: async (disclosureId, bankProductId) => {
    set({ busyId: disclosureId, error: null });
    try {
      await executeAgencyBankWithdrawal(disclosureId, bankProductId);
      await get().refresh();
    } catch (error) {
      set({ error: toUserFacingError(error, "Bank execution failed") });
      throw error;
    } finally {
      set({ busyId: null });
    }
  },

  payWithdrawal: async (disclosureId) => {
    set({ busyId: disclosureId, error: null });
    try {
      await tellerPayAgencyWithdrawal(disclosureId);
      await get().refresh();
    } catch (error) {
      set({ error: toUserFacingError(error, "Cash payout failed") });
      throw error;
    } finally {
      set({ busyId: null });
    }
  },

  startLiveSync: () => {
    if (get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: ["customer_transactions", "customer_balance_disclosures"],
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
