import { create } from "zustand";
import type { AgentReport, Branch, BranchReport, SummaryReport } from "../api";
import { getPerformanceBootstrap, getTenantId } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type PerformanceState = {
  summary: SummaryReport | null;
  agents: AgentReport[];
  branchReports: BranchReport[];
  branches: Branch[];
  agentNames: Record<string, string>;
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

function performanceSnapshotKey(data: {
  summary: SummaryReport | null;
  agents: AgentReport[];
  branchReports: BranchReport[];
}): string {
  const summary = data.summary
    ? `${data.summary.totalTransactions}:${data.summary.totalDeposits}:${data.summary.totalWithdrawals}:${data.summary.totalDailySusu}`
    : "";
  const agents = data.agents
    .slice(0, 30)
    .map((a) => `${a.fieldAgentId}:${a.totalCollections}:${a.withdrawalCount}`)
    .join(",");
  const branches = data.branchReports
    .slice(0, 30)
    .map((b) => `${b.branchId}:${b.totalAmount}:${b.transactionCount}`)
    .join(",");
  return `${summary}|${agents}|${branches}`;
}

export const usePerformanceStore = create<PerformanceState>((set, get) => ({
  summary: null,
  agents: [],
  branchReports: [],
  branches: [],
  agentNames: {},
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
        const data = await getPerformanceBootstrap(get().branchFilter || undefined);
        const key = performanceSnapshotKey(data);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            summary: data.summary,
            agents: data.agents,
            branchReports: data.branchReports,
            branches: data.branches,
            agentNames: data.agentNames,
            lastFetchedAt: Date.now(),
            error: null
          });
        }
      } catch (error) {
        set({ error: toUserFacingError(error, "Failed to load performance") });
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
        const data = await getPerformanceBootstrap(get().branchFilter || undefined);
        const key = performanceSnapshotKey(data);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            summary: data.summary,
            agents: data.agents,
            branchReports: data.branchReports,
            branches: data.branches,
            agentNames: data.agentNames,
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
      tables: ["customer_transactions", "customers", "users"],
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

export function selectAgentDisplayName(
  agentId: string,
  agentNames: Record<string, string>
): string {
  return agentNames[agentId] ?? agentId.slice(0, 8);
}

export function selectBranchDisplayName(branchId: string, branches: Branch[]): string {
  const match = branches.find((b) => b.id === branchId);
  return match ? `${match.name} (${match.code})` : branchId;
}
