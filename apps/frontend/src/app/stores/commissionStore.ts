import { create } from "zustand";
import type { CommissionPolicy } from "../api";
import { getCommissionPolicy, getTenantId } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type CommissionState = {
  policy: CommissionPolicy | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  setPolicy: (policy: CommissionPolicy) => void;
  setSaving: (saving: boolean) => void;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

function policySnapshotKey(policy: CommissionPolicy): string {
  return JSON.stringify({
    enabled: policy.enabled,
    fieldAgentCommissionPercent: policy.fieldAgentCommissionPercent,
    coordinatorCommissionPercent: policy.coordinatorCommissionPercent,
    basis: policy.basis,
    bonusRules: policy.bonusRules
  });
}

function normalizePolicy(data: CommissionPolicy): CommissionPolicy {
  return { ...data, bonusRules: data.bonusRules ?? [] };
}

export const useCommissionStore = create<CommissionState>((set, get) => ({
  policy: null,
  loading: false,
  saving: false,
  error: null,
  lastFetchedAt: null,
  liveSyncActive: false,

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

  setPolicy: (policy) => {
    lastSnapshotKey = "";
    set({ policy });
  },

  setSaving: (saving) => set({ saving }),

  refresh: async () => {
    if (fetchInFlight) {
      set({ loading: true });
      await fetchInFlight;
      set({ loading: false });
      return;
    }

    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        const data = normalizePolicy(await getCommissionPolicy());
        const key = policySnapshotKey(data);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({ policy: data, lastFetchedAt: Date.now(), error: null });
        }
      } catch (error) {
        set({ error: toUserFacingError(error, "Failed to load commission policy") });
      } finally {
        set({ loading: false });
        fetchInFlight = null;
      }
    })();
    await fetchInFlight;
  },

  refreshSilent: async () => {
    if (fetchInFlight) {
      return fetchInFlight;
    }
    fetchInFlight = (async () => {
      try {
        const data = normalizePolicy(await getCommissionPolicy());
        const key = policySnapshotKey(data);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({ policy: data, lastFetchedAt: Date.now(), error: null });
        }
      } catch {
        /* keep cache */
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  startLiveSync: () => {
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: [],
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt)
    });
  },

  stopLiveSync: () => {
    liveSync.stop();
    silentScheduler.clear();
    set({ liveSyncActive: false });
  }
}));
