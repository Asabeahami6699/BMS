import { create } from "zustand";
import type { Branch, Customer } from "../api";
import { getGroupSavingsBootstrap, getTenantId } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

export type GroupSavingsTotals = {
  totalMembers: number;
  activeMembers: number;
  pendingMembers: number;
  totalDailyPlan: number;
};

type GroupSavingsState = {
  members: Customer[];
  branches: Branch[];
  totals: GroupSavingsTotals;
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

const emptyTotals: GroupSavingsTotals = {
  totalMembers: 0,
  activeMembers: 0,
  pendingMembers: 0,
  totalDailyPlan: 0
};

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

function groupSnapshotKey(members: Customer[], totals: GroupSavingsTotals): string {
  const memberSig = members
    .map((m) => `${m.id}:${m.status}:${m.dailyContributionAmount}:${m.accountBalance ?? ""}`)
    .join("|");
  return `${memberSig}|${totals.totalMembers}:${totals.activeMembers}:${totals.pendingMembers}:${totals.totalDailyPlan}`;
}

export const useGroupSavingsStore = create<GroupSavingsState>((set, get) => ({
  members: [],
  branches: [],
  totals: emptyTotals,
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
        const data = await getGroupSavingsBootstrap(get().branchFilter || undefined);
        const key = groupSnapshotKey(data.members, data.totals);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            members: data.members,
            branches: data.branches,
            totals: data.totals,
            lastFetchedAt: Date.now(),
            error: null
          });
        }
      } catch (error) {
        set({ error: toUserFacingError(error, "Failed to load group savings") });
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
        const data = await getGroupSavingsBootstrap(get().branchFilter || undefined);
        const key = groupSnapshotKey(data.members, data.totals);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            members: data.members,
            branches: data.branches,
            totals: data.totals,
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
      tables: ["customers", "customer_transactions"],
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
