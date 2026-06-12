import { create } from "zustand";
import type {
  AgentReport,
  BalanceDisclosure,
  Branch,
  Customer,
  FieldAgentOption,
  FieldAgentRosterRow
} from "../api";
import { getAgentsBootstrap, getTenantId } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

export type AgentsKpis = {
  totalAgents: number;
  activeAgents: number;
  assignedCustomers: number;
  pendingRegistrations: number;
  pendingAgentRequests: number;
  totalCollections: number;
};

type AgentsState = {
  roster: FieldAgentRosterRow[];
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

function branchLabel(branchId: string | undefined, branches: Branch[]): string {
  if (!branchId) {
    return "—";
  }
  const match = branches.find((b) => b.id === branchId);
  return match ? `${match.name} (${match.code})` : branchId;
}

function buildRoster(
  agents: FieldAgentOption[],
  customers: Customer[],
  reports: AgentReport[],
  pending: BalanceDisclosure[],
  branches: Branch[],
  branchFilter: string
): FieldAgentRosterRow[] {
  const reportByAgent = new Map(reports.map((r) => [r.fieldAgentId, r]));

  const rows = agents.map((agent) => {
    const assigned = customers.filter((c) => c.assignedFieldAgentId === agent.userId);
    const activeCustomers = assigned.filter((c) => c.status === "active").length;
    const pendingRegistrations = assigned.filter((c) => c.status === "pending_activation").length;
    const pendingRequests = pending.filter(
      (r) => r.fieldAgentId === agent.userId && r.status === "pending"
    ).length;
    const report = reportByAgent.get(agent.userId);
    const transactionCount =
      (report?.dailySusuCount ?? 0) + (report?.depositCount ?? 0) + (report?.withdrawalCount ?? 0);

    return {
      ...agent,
      status: agent.status ?? "active",
      displayName: agent.fullName?.trim() || agent.email || agent.userId,
      branchLabel: branchLabel(agent.branchId, branches),
      activeCustomers,
      pendingRegistrations,
      pendingRequests,
      totalCollections: report?.totalCollections ?? 0,
      transactionCount,
      dailySusuCount: report?.dailySusuCount ?? 0,
      depositCount: report?.depositCount ?? 0,
      withdrawalCount: report?.withdrawalCount ?? 0,
      dailySusuAmount: report?.dailySusuAmount ?? 0,
      depositAmount: report?.depositAmount ?? 0,
      withdrawalAmount: report?.withdrawalAmount ?? 0
    };
  });

  const filtered =
    branchFilter.trim().length > 0
      ? rows.filter((r) => r.branchId === branchFilter)
      : rows;

  return filtered.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "active" ? -1 : 1;
    }
    return b.totalCollections - a.totalCollections || a.displayName.localeCompare(b.displayName);
  });
}

function computeKpis(roster: FieldAgentRosterRow[]): AgentsKpis {
  const activeAgents = roster.filter((r) => r.status === "active").length;
  return {
    totalAgents: roster.length,
    activeAgents,
    assignedCustomers: roster.reduce((sum, r) => sum + r.activeCustomers, 0),
    pendingRegistrations: roster.reduce((sum, r) => sum + r.pendingRegistrations, 0),
    pendingAgentRequests: roster.reduce((sum, r) => sum + r.pendingRequests, 0),
    totalCollections: roster.reduce((sum, r) => sum + r.totalCollections, 0)
  };
}

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

function rosterSnapshotKey(roster: FieldAgentRosterRow[]): string {
  return roster
    .map(
      (r) =>
        `${r.userId}:${r.status}:${r.activeCustomers}:${r.pendingRegistrations}:${r.pendingRequests}:${r.totalCollections}`
    )
    .join("|");
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
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
        const data = await getAgentsBootstrap(get().branchFilter || undefined);
        const roster = buildRoster(
          data.agents,
          data.customers,
          data.reports,
          data.pending,
          data.branches,
          get().branchFilter
        );
        const key = rosterSnapshotKey(roster);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            roster,
            branches: data.branches,
            lastFetchedAt: Date.now(),
            error: null
          });
        }
      } catch (error) {
        set({ error: toUserFacingError(error, "Failed to load field agents") });
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
        const data = await getAgentsBootstrap(get().branchFilter || undefined);
        const roster = buildRoster(
          data.agents,
          data.customers,
          data.reports,
          data.pending,
          data.branches,
          get().branchFilter
        );
        const key = rosterSnapshotKey(roster);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            roster,
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
      tables: ["customers", "customer_balance_disclosures", "customer_transactions", "users"],
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

export function selectAgentsKpis(state: AgentsState): AgentsKpis {
  return computeKpis(state.roster);
}
