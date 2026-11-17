import { create } from "zustand";
import type { SusuCommissionPolicy, UpdateSusuCommissionPolicyInput } from "@bms/shared";
import {
  getSusuCycleCommissionPolicy,
  updateSusuCycleCommissionPolicy
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";
import { getTenantId } from "../api";

type State = {
  policy: SusuCommissionPolicy | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;
  setPolicy: (policy: SusuCommissionPolicy) => void;
  setSaving: (saving: boolean) => void;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  save: (input: UpdateSusuCommissionPolicyInput) => Promise<SusuCommissionPolicy>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

export const useSusuCycleCommissionStore = create<State>((set, get) => ({
  policy: null,
  loading: false,
  saving: false,
  error: null,
  lastFetchedAt: null,
  liveSyncActive: false,

  setPolicy: (policy) => set({ policy }),
  setSaving: (saving) => set({ saving }),

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
    if (fetchInFlight) {
      return fetchInFlight;
    }
    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        const policy = await getSusuCycleCommissionPolicy();
        set({ policy, loading: false, lastFetchedAt: Date.now(), error: null });
      } catch (error) {
        set({
          loading: false,
          error: toUserFacingError(error, "Could not load Susu cycle fee policy")
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
    fetchInFlight = (async () => {
      try {
        const policy = await getSusuCycleCommissionPolicy();
        set({ policy, lastFetchedAt: Date.now(), error: null });
      } catch {
        /* keep */
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  save: async (input) => {
    set({ saving: true, error: null });
    try {
      const policy = await updateSusuCycleCommissionPolicy(input);
      set({ policy, saving: false, lastFetchedAt: Date.now() });
      return policy;
    } catch (error) {
      set({
        saving: false,
        error: toUserFacingError(error, "Could not save Susu cycle fee policy")
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
      tables: ["susu_commission_policies", "susu_customer_cycles"],
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
