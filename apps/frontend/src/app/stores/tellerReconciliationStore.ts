import { create } from "zustand";
import type { TellerReconciliationBootstrap } from "@bms/shared";
import {
  getRuntimeBranchId,
  getTenantId,
  getTellerReconciliationBootstrap,
  setRuntimeBranchId
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

const STALE_MS = 20_000;
const silentScheduler = createSilentRefreshScheduler();
const liveSyncMgr = createLiveSyncManager();

type State = {
  data: TellerReconciliationBootstrap | null;
  businessDate: string;
  branchId: string;
  transactionType: "" | "deposit" | "withdrawal" | "daily_susu";
  bankProductId: string;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;
  hydrate: (options?: {
    force?: boolean;
    branchId?: string;
    date?: string;
    fallbackBranchId?: string;
  }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  setBusinessDate: (date: string) => void;
  setBranchId: (branchId: string) => void;
  setTransactionType: (type: State["transactionType"]) => void;
  setBankProductId: (bankProductId: string) => void;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveInitialBranch(fallbackBranchId?: string): string {
  return getRuntimeBranchId() || fallbackBranchId || "";
}

export const useTellerReconciliationStore = create<State>((set, get) => ({
  data: null,
  businessDate: todayIso(),
  branchId: resolveInitialBranch(),
  transactionType: "",
  bankProductId: "",
  loading: false,
  error: null,
  lastFetchedAt: null,
  liveSyncActive: false,

  hydrate: (options) => {
    const branchId = options?.branchId ?? options?.fallbackBranchId ?? get().branchId;
    if (branchId) {
      set({ branchId });
      setRuntimeBranchId(branchId);
    }
    if (options?.date) {
      set({ businessDate: options.date });
    }
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
    if (fetchInFlight) return fetchInFlight;
    const { branchId, businessDate, transactionType, bankProductId } = get();
    if (!branchId) {
      set({ error: "Select a branch to load reconciliation" });
      return;
    }
    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        const data = await getTellerReconciliationBootstrap({
          branchId,
          date: businessDate,
          transactionType: transactionType || undefined,
          bankProductId: bankProductId || undefined
        });
        set({ data, lastFetchedAt: Date.now(), error: null });
      } catch (error) {
        set({ error: toUserFacingError(error, "Could not load teller reconciliation") });
      } finally {
        set({ loading: false });
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  refreshSilent: async () => {
    if (fetchInFlight) return fetchInFlight;
    const { branchId, businessDate, transactionType, bankProductId } = get();
    if (!branchId) return;
    fetchInFlight = (async () => {
      try {
        const data = await getTellerReconciliationBootstrap({
          branchId,
          date: businessDate,
          transactionType: transactionType || undefined,
          bankProductId: bankProductId || undefined
        });
        set({ data, lastFetchedAt: Date.now(), error: null });
      } catch {
        /* keep cache */
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  setBusinessDate: (date) => {
    set({ businessDate: date });
    void get().refresh();
  },

  setBranchId: (branchId) => {
    set({ branchId });
    setRuntimeBranchId(branchId);
    void get().refresh();
  },

  setTransactionType: (transactionType) => {
    set({ transactionType });
    void get().refresh();
  },

  setBankProductId: (bankProductId) => {
    set({ bankProductId });
    void get().refresh();
  },

  startLiveSync: () => {
    if (get().liveSyncActive) return;
    set({ liveSyncActive: true });
    liveSyncMgr.start({
      getTenantId,
      tables: ["customer_transactions", "branch_float_sessions", "teller_till_journal_entries"],
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt, STALE_MS)
    });
  },

  stopLiveSync: () => {
    if (!get().liveSyncActive) return;
    liveSyncMgr.stop();
    silentScheduler.clear();
    set({ liveSyncActive: false });
  }
}));
