import { create } from "zustand";
import type {
  AgentReport,
  BalanceDisclosure,
  Branch,
  BranchReport,
  Customer,
  SummaryReport
} from "../api";
import { getCoordinatorBootstrap, getTenantId } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

export type CoordinatorKpis = {
  activeCustomers: number;
  pendingRegistrations: number;
  pendingAgentRequests: number;
  pendingWithdrawals: number;
  pendingBalanceRequests: number;
  totalCollections: number;
  totalTransactions: number;
};

type CoordinatorState = {
  customers: Customer[];
  pendingRegistrations: Customer[];
  pendingRequests: BalanceDisclosure[];
  summary: SummaryReport | null;
  agents: AgentReport[];
  branches: Branch[];
  branchReports: BranchReport[];
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
  mergeCustomer: (customer: Customer) => void;
  removePendingRegistration: (customerId: string) => void;
  removePendingRequest: (requestId: string) => void;
};

function computeKpis(state: {
  customers: Customer[];
  pendingRegistrations: Customer[];
  pendingRequests: BalanceDisclosure[];
  summary: SummaryReport | null;
}): CoordinatorKpis {
  const activeCustomers = state.customers.filter((c) => c.status === "active").length;
  const pendingWithdrawals = state.pendingRequests.filter((r) => r.requestType === "withdrawal").length;
  const pendingBalanceRequests = state.pendingRequests.filter((r) => r.requestType === "balance").length;
  const totalCollections =
    (state.summary?.totalDailySusu ?? 0) +
    (state.summary?.totalDeposits ?? 0) -
    (state.summary?.totalWithdrawals ?? 0);

  return {
    activeCustomers,
    pendingRegistrations: state.pendingRegistrations.length,
    pendingAgentRequests: state.pendingRequests.length,
    pendingWithdrawals,
    pendingBalanceRequests,
    totalCollections: Math.max(0, totalCollections),
    totalTransactions: state.summary?.totalTransactions ?? 0
  };
}

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

function coordinatorSnapshotKey(data: {
  pendingRegistrations: Customer[];
  pendingRequests: BalanceDisclosure[];
  summary: SummaryReport | null;
  agents: AgentReport[];
  branchReports: BranchReport[];
  customersCount: number;
}): string {
  const pendingReg = data.pendingRegistrations.map((c) => `${c.id}:${c.status}`).join(",");
  const pendingReq = data.pendingRequests.map((r) => `${r.id}:${r.status}:${r.requestType}`).join(",");
  const summary = data.summary
    ? `${data.summary.totalTransactions}:${data.summary.totalDeposits}:${data.summary.totalWithdrawals}:${data.summary.totalDailySusu}`
    : "";
  const agents = data.agents
    .slice(0, 20)
    .map((a) => `${a.fieldAgentId}:${a.totalCollections}`)
    .join(",");
  const branches = data.branchReports
    .slice(0, 20)
    .map((b) => `${b.branchId}:${b.totalAmount}`)
    .join(",");
  return `${data.customersCount}|${pendingReg}|${pendingReq}|${summary}|${agents}|${branches}`;
}

function applyCoordinatorBootstrap(
  data: Awaited<ReturnType<typeof getCoordinatorBootstrap>>
): Partial<CoordinatorState> | null {
  const key = coordinatorSnapshotKey({
    pendingRegistrations: data.pendingRegistrations,
    pendingRequests: data.pendingRequests,
    summary: data.summary,
    agents: data.agents,
    branchReports: data.branchReports,
    customersCount: data.customers.length
  });
  if (key === lastSnapshotKey) {
    return null;
  }
  lastSnapshotKey = key;
  return {
    customers: data.customers,
    pendingRegistrations: data.pendingRegistrations,
    pendingRequests: data.pendingRequests,
    summary: data.summary,
    agents: data.agents,
    branchReports: data.branchReports,
    branches: data.branches,
    lastFetchedAt: Date.now(),
    error: null
  };
}

export const useCoordinatorStore = create<CoordinatorState>((set, get) => ({
  customers: [],
  pendingRegistrations: [],
  pendingRequests: [],
  summary: null,
  agents: [],
  branches: [],
  branchReports: [],
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

  mergeCustomer: (customer) => {
    const existing = get().customers;
    const idx = existing.findIndex((c) => c.id === customer.id);
    const customers =
      idx >= 0 ? existing.map((c, i) => (i === idx ? customer : c)) : [customer, ...existing];
    const pendingRegistrations = customers.filter((c) => c.status === "pending_activation");
    lastSnapshotKey = "";
    set({
      customers: [...customers].sort((a, b) => a.fullName.localeCompare(b.fullName)),
      pendingRegistrations: [...pendingRegistrations].sort((a, b) =>
        a.fullName.localeCompare(b.fullName)
      )
    });
  },

  removePendingRegistration: (customerId) => {
    lastSnapshotKey = "";
    set((state) => ({
      pendingRegistrations: state.pendingRegistrations.filter((c) => c.id !== customerId),
      customers: state.customers.map((c) =>
        c.id === customerId ? { ...c, status: "active" as const } : c
      )
    }));
  },

  removePendingRequest: (requestId) => {
    lastSnapshotKey = "";
    set((state) => ({
      pendingRequests: state.pendingRequests.filter((r) => r.id !== requestId)
    }));
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
        const data = await getCoordinatorBootstrap(get().branchFilter || undefined);
        const patch = applyCoordinatorBootstrap(data);
        if (patch) {
          set(patch);
        }
      } catch (error) {
        set({ error: toUserFacingError(error, "Failed to load coordinator data") });
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
        const data = await getCoordinatorBootstrap(get().branchFilter || undefined);
        const patch = applyCoordinatorBootstrap(data);
        if (patch) {
          set(patch);
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
      tables: ["customers", "customer_balance_disclosures", "customer_transactions"],
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

export function selectCoordinatorKpis(state: CoordinatorState): CoordinatorKpis {
  return computeKpis(state);
}

export function selectTopAgents(state: CoordinatorState, limit = 5): AgentReport[] {
  return state.agents.slice(0, limit);
}

export function selectTopBranches(state: CoordinatorState, limit = 4): BranchReport[] {
  return state.branchReports.slice(0, limit);
}
