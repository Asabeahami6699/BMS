import { create } from "zustand";
import type {
  Branch,
  CashVarianceCase,
  CashVarianceSettlementMethod,
  Customer,
  PendingCollectionBatch
} from "../api";
import {
  getAuthMe,
  getTenantId,
  listBranches,
  listCashVariances,
  listCustomers,
  listFieldAgents,
  listPendingCollectionBatches,
  postAllCollectionBatches,
  postCollectionBatch,
  settleCashVariance
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type AgentRow = { userId: string; fullName: string; email: string; branchId?: string };

type CalloverBatchesState = {
  businessDate: string;
  branchId: string;
  branchLocked: boolean;
  fieldAgentId: string;
  batches: PendingCollectionBatch[];
  customers: Customer[];
  branches: Branch[];
  agents: AgentRow[];
  variances: CashVarianceCase[];
  loading: boolean;
  busyId: string | null;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;

  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;

  initScope: () => Promise<void>;
  setBusinessDate: (value: string) => void;
  setBranchId: (value: string) => void;
  setFieldAgentId: (value: string) => void;

  postBatch: (batchId: string, cashReceivedAmount: number) => Promise<PendingCollectionBatch>;
  postAll: (cashByBatchId: Record<string, number>) => Promise<{ posted: number; batchIds: string[] }>;
  settleVariance: (
    varianceId: string,
    input: { amount: number; method: CashVarianceSettlementMethod; notes?: string }
  ) => Promise<CashVarianceCase>;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

let fetchInFlight: Promise<void> | null = null;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

export const useCalloverBatchesStore = create<CalloverBatchesState>((set, get) => ({
  businessDate: todayIso(),
  branchId: "",
  branchLocked: false,
  fieldAgentId: "",
  batches: [],
  customers: [],
  branches: [],
  agents: [],
  variances: [],
  loading: false,
  busyId: null,
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

  initScope: async () => {
    try {
      const me = await getAuthMe();
      if (me.scopeType === "branch" && me.branchId) {
        set({ branchId: me.branchId, branchLocked: true });
      }
    } catch {
      /* ignore */
    }
  },

  setBusinessDate: (value) => {
    set({ businessDate: value });
    void get().refresh();
  },
  setBranchId: (value) => {
    if (get().branchLocked) {
      return;
    }
    set({ branchId: value });
    void get().refresh();
  },
  setFieldAgentId: (value) => {
    set({ fieldAgentId: value });
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
        const { businessDate, fieldAgentId, branchId } = get();
        const [batchRows, customerRows, agentRows, branchRows, varianceRows] = await Promise.all([
          listPendingCollectionBatches({
            businessDate,
            fieldAgentId: fieldAgentId || undefined,
            branchId: branchId || undefined
          }),
          listCustomers(),
          listFieldAgents(),
          listBranches(),
          listCashVariances({
            status: "open",
            fieldAgentId: fieldAgentId || undefined,
            branchId: branchId || undefined
          })
        ]);
        set({
          batches: batchRows,
          customers: customerRows,
          branches: branchRows.filter((b) => b.status !== "inactive"),
          agents: agentRows.map((a) => ({
            userId: a.userId,
            fullName: a.fullName ?? a.email,
            email: a.email,
            branchId: a.branchId
          })),
          variances: varianceRows,
          loading: false,
          lastFetchedAt: Date.now(),
          error: null
        });
      } catch (error) {
        set({
          loading: false,
          error: toUserFacingError(error, "Failed to load callover batches")
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
        const { businessDate, fieldAgentId, branchId } = get();
        const [batchRows, varianceRows] = await Promise.all([
          listPendingCollectionBatches({
            businessDate,
            fieldAgentId: fieldAgentId || undefined,
            branchId: branchId || undefined
          }),
          listCashVariances({
            status: "open",
            fieldAgentId: fieldAgentId || undefined,
            branchId: branchId || undefined
          })
        ]);
        set({
          batches: batchRows,
          variances: varianceRows,
          lastFetchedAt: Date.now(),
          error: null
        });
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
      tables: ["collection_batches", "collection_batch_lines", "field_agent_cash_variances"],
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt)
    });
  },

  stopLiveSync: () => {
    liveSync.stop();
    silentScheduler.clear();
    set({ liveSyncActive: false });
  },

  postBatch: async (batchId, cashReceivedAmount) => {
    set({ busyId: batchId });
    try {
      const posted = await postCollectionBatch(batchId, { cashReceivedAmount });
      await get().refreshSilent();
      return posted;
    } finally {
      set({ busyId: null });
    }
  },

  postAll: async (cashByBatchId) => {
    set({ busyId: "all" });
    try {
      const { businessDate, fieldAgentId, branchId } = get();
      const result = await postAllCollectionBatches({
        businessDate,
        fieldAgentId: fieldAgentId || undefined,
        branchId: branchId || undefined,
        cashByBatchId
      });
      await get().refreshSilent();
      return result;
    } finally {
      set({ busyId: null });
    }
  },

  settleVariance: async (varianceId, input) => {
    set({ busyId: `settle:${varianceId}` });
    try {
      const updated = await settleCashVariance(varianceId, input);
      await get().refreshSilent();
      return updated;
    } finally {
      set({ busyId: null });
    }
  }
}));
