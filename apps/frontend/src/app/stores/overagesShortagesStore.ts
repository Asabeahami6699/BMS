import { create } from "zustand";
import type {
  CashVarianceCase,
  CashVarianceSettlementMethod,
  CashVarianceType,
  Customer,
  TellerTillCashVarianceCase
} from "../api";
import {
  creditCustomerFromOverage,
  getTenantId,
  listCashVariances,
  listCustomers,
  listFieldAgents,
  listTellerTillCashVariances,
  settleCashVariance,
  settleTellerTillCashVariance
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type OsSource = "field_agent" | "teller_till";

type OveragesShortagesState = {
  fromDate: string;
  toDate: string;
  fieldAgentId: string;
  varianceType: "" | CashVarianceType;
  status: "open" | "all";
  cases: CashVarianceCase[];
  tillCases: TellerTillCashVarianceCase[];
  customers: Customer[];
  agents: { userId: string; fullName: string; email: string }[];
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

  setFromDate: (value: string) => void;
  setToDate: (value: string) => void;
  setFieldAgentId: (value: string) => void;
  setVarianceType: (value: "" | CashVarianceType) => void;
  setStatus: (value: "open" | "all") => void;

  settleField: (
    varianceId: string,
    input: { amount: number; method: CashVarianceSettlementMethod; notes?: string }
  ) => Promise<CashVarianceCase>;
  settleTill: (
    varianceId: string,
    input: { amount: number; method: CashVarianceSettlementMethod; notes?: string }
  ) => Promise<TellerTillCashVarianceCase>;
  creditCustomer: (
    varianceId: string,
    input: { customerId: string; amount: number; notes?: string }
  ) => Promise<void>;
};

let fetchInFlight: Promise<void> | null = null;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

export const useOveragesShortagesStore = create<OveragesShortagesState>((set, get) => ({
  fromDate: "",
  toDate: "",
  fieldAgentId: "",
  varianceType: "",
  status: "open",
  cases: [],
  tillCases: [],
  customers: [],
  agents: [],
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

  setFromDate: (value) => {
    set({ fromDate: value });
    void get().refresh();
  },
  setToDate: (value) => {
    set({ toDate: value });
    void get().refresh();
  },
  setFieldAgentId: (value) => {
    set({ fieldAgentId: value });
    void get().refresh();
  },
  setVarianceType: (value) => {
    set({ varianceType: value });
    void get().refresh();
  },
  setStatus: (value) => {
    set({ status: value });
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
        const { status, fieldAgentId, varianceType, fromDate, toDate } = get();
        const [fieldRows, tillRows, agentRows, customerRows] = await Promise.all([
          listCashVariances({
            status,
            fieldAgentId: fieldAgentId || undefined,
            varianceType: varianceType || undefined,
            fromDate: fromDate || undefined,
            toDate: toDate || undefined
          }),
          listTellerTillCashVariances({
            status,
            varianceType: varianceType || undefined,
            fromDate: fromDate || undefined,
            toDate: toDate || undefined
          }),
          listFieldAgents(),
          listCustomers()
        ]);
        set({
          cases: fieldRows,
          tillCases: tillRows,
          agents: agentRows.map((a) => ({
            userId: a.userId,
            fullName: a.fullName ?? a.email,
            email: a.email
          })),
          customers: customerRows.filter((c) => c.status === "active"),
          loading: false,
          lastFetchedAt: Date.now(),
          error: null
        });
      } catch (error) {
        set({
          loading: false,
          error: toUserFacingError(error, "Failed to load overages & shortages")
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
        const { status, fieldAgentId, varianceType, fromDate, toDate } = get();
        const [fieldRows, tillRows] = await Promise.all([
          listCashVariances({
            status,
            fieldAgentId: fieldAgentId || undefined,
            varianceType: varianceType || undefined,
            fromDate: fromDate || undefined,
            toDate: toDate || undefined
          }),
          listTellerTillCashVariances({
            status,
            varianceType: varianceType || undefined,
            fromDate: fromDate || undefined,
            toDate: toDate || undefined
          })
        ]);
        set({
          cases: fieldRows,
          tillCases: tillRows,
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
      tables: [
        "field_agent_cash_variances",
        "teller_till_cash_variances",
        "collection_batches"
      ],
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt)
    });
  },

  stopLiveSync: () => {
    liveSync.stop();
    silentScheduler.clear();
    set({ liveSyncActive: false });
  },

  settleField: async (varianceId, input) => {
    set({ busyId: varianceId });
    try {
      const updated = await settleCashVariance(varianceId, input);
      await get().refreshSilent();
      return updated;
    } finally {
      set({ busyId: null });
    }
  },

  settleTill: async (varianceId, input) => {
    set({ busyId: varianceId });
    try {
      const updated = await settleTellerTillCashVariance(varianceId, input);
      await get().refreshSilent();
      return updated;
    } finally {
      set({ busyId: null });
    }
  },

  creditCustomer: async (varianceId, input) => {
    set({ busyId: varianceId });
    try {
      await creditCustomerFromOverage(varianceId, input);
      await get().refreshSilent();
    } finally {
      set({ busyId: null });
    }
  }
}));

export type { OsSource };
