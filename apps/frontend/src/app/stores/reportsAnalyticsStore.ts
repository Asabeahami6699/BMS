import { create } from "zustand";
import type { ReportsAnalyticsBootstrapResponse } from "../api";
import { getReportsAnalyticsBootstrap, getTenantId } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type ReportsAnalyticsState = {
  data: ReportsAnalyticsBootstrapResponse | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  branchFilter: string;
  liveSyncActive: boolean;
  hydrate: (options?: { force?: boolean }) => void;
  setBranchFilter: (branchId: string) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

function snapshotKey(data: ReportsAnalyticsBootstrapResponse | null): string {
  if (!data) {
    return "";
  }
  const trend = data.dailyTrend.map((d) => `${d.date}:${d.net}`).join(",");
  return `${data.summary.totalTransactions}|${trend}|${data.pending.registrations}|${data.withdrawals.pending}`;
}

export const useReportsAnalyticsStore = create<ReportsAnalyticsState>((set, get) => ({
  data: null,
  loading: false,
  error: null,
  lastFetchedAt: null,
  branchFilter: "",
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

  setBranchFilter: (branchId) => {
    set({ branchFilter: branchId });
    lastSnapshotKey = "";
    void get().refresh();
  },

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
        const data = await getReportsAnalyticsBootstrap(get().branchFilter || undefined);
        const key = snapshotKey(data);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({ data, lastFetchedAt: Date.now(), error: null });
        } else {
          set({ lastFetchedAt: Date.now(), error: null });
        }
      } catch (error) {
        set({ error: toUserFacingError(error, "Failed to load reports") });
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
        const data = await getReportsAnalyticsBootstrap(get().branchFilter || undefined);
        const key = snapshotKey(data);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({ data, lastFetchedAt: Date.now(), error: null });
        } else {
          set({ lastFetchedAt: Date.now() });
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
      tables: ["customer_transactions", "customers", "customer_balance_disclosures"],
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
