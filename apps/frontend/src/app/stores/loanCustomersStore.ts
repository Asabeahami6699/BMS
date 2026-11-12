import { create } from "zustand";
import type { LoanBorrowerRow } from "../api";
import { getTenantId, listLoanBorrowers } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type LoanCustomersState = {
  rows: LoanBorrowerRow[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

function rowsKey(rows: LoanBorrowerRow[]): string {
  return rows
    .map(
      (r) =>
        `${r.customerId}:${r.latestLoanStatus ?? ""}:${r.activeLoanCount ?? 0}:${r.totalOutstanding ?? 0}`
    )
    .join("|");
}

export const useLoanCustomersStore = create<LoanCustomersState>((set, get) => ({
  rows: [],
  loading: false,
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
        const rows = await listLoanBorrowers();
        const key = rowsKey(rows);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({ rows, loading: false, lastFetchedAt: Date.now(), error: null });
        } else {
          set({ loading: false, lastFetchedAt: Date.now(), error: null });
        }
      } catch (error) {
        set({
          loading: false,
          error: toUserFacingError(error, "Failed to load loan customers")
        });
      } finally {
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
        const rows = await listLoanBorrowers();
        const key = rowsKey(rows);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({ rows, lastFetchedAt: Date.now(), error: null });
        } else {
          set({ lastFetchedAt: Date.now(), error: null });
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
    if (get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: ["loan_applications", "customers"],
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
