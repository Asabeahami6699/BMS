import { create } from "zustand";
import type { Branch, CoordinatorRosterRow } from "../api";
import { getCoordinatorsBootstrap, getTenantId } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

export type CoordinatorsKpis = {
  totalCoordinators: number;
  activeCoordinators: number;
  pendingRegistrations: number;
  pendingRequests: number;
  totalApprovals: number;
};

type CoordinatorsState = {
  roster: CoordinatorRosterRow[];
  branches: Branch[];
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

function computeKpis(roster: CoordinatorRosterRow[]): CoordinatorsKpis {
  const active = roster.filter((r) => r.status === "active");
  const pendingRegistrations =
    roster.length > 0 ? Math.max(...roster.map((r) => r.pendingRegistrations)) : 0;
  const pendingRequests = roster.length > 0 ? Math.max(...roster.map((r) => r.pendingRequests)) : 0;
  return {
    totalCoordinators: roster.length,
    activeCoordinators: active.length,
    pendingRegistrations,
    pendingRequests,
    totalApprovals: roster.reduce((sum, r) => sum + r.approvalsProcessed, 0)
  };
}

function applyBranchFilter(roster: CoordinatorRosterRow[], branchFilter: string): CoordinatorRosterRow[] {
  if (!branchFilter.trim()) {
    return roster;
  }
  return roster.filter((r) => r.branchId === branchFilter || r.scopeType === "head_office");
}

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

function rosterSnapshotKey(roster: CoordinatorRosterRow[]): string {
  return roster
    .map(
      (r) =>
        `${r.userId}:${r.status}:${r.pendingRegistrations}:${r.pendingRequests}:${r.approvalsProcessed}`
    )
    .join("|");
}

export const useCoordinatorsStore = create<CoordinatorsState>((set, get) => ({
  roster: [],
  branches: [],
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
    void get().refreshSilent();
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
        const data = await getCoordinatorsBootstrap();
        const filtered = applyBranchFilter(data.roster, get().branchFilter);
        const key = rosterSnapshotKey(filtered);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            roster: filtered,
            branches: data.branches,
            lastFetchedAt: Date.now(),
            error: null
          });
        }
      } catch (error) {
        set({ error: toUserFacingError(error, "Failed to load coordinators") });
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
        const data = await getCoordinatorsBootstrap();
        const filtered = applyBranchFilter(data.roster, get().branchFilter);
        const key = rosterSnapshotKey(filtered);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            roster: filtered,
            branches: data.branches,
            lastFetchedAt: Date.now(),
            error: null
          });
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
      tables: ["users", "customers", "customer_balance_disclosures"],
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

export function selectCoordinatorsKpis(state: CoordinatorsState): CoordinatorsKpis {
  return computeKpis(state.roster);
}
