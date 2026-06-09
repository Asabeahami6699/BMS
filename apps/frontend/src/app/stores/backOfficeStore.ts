import { create } from "zustand";
import type { BackOfficeBootstrap, OpenBackOfficeDayInput } from "@bms/shared";
import {
  approveBackOfficeAccountantDeposit,
  approveBackOfficeEcashRequest,
  createBackOfficeEcashRequest,
  executeBackOfficeDepositDone,
  getBackOfficeBootstrap,
  getRuntimeBranchId,
  getTenantId,
  openBackOfficeDay,
  setRuntimeBranchId,
  updateBackOfficeAccountEntries
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
  data: BackOfficeBootstrap | null;
  branchId: string;
  businessDate: string;
  loading: boolean;
  busyId: string | null;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;
  executionAccountByDeposit: Record<string, string>;

  hydrate: (options?: { force?: boolean; branchId?: string; fallbackBranchId?: string }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  setBranchId: (branchId: string) => void;
  setBusinessDate: (date: string) => void;
  setExecutionAccount: (depositId: string, bankProductId: string) => void;
  openDay: (payload: OpenBackOfficeDayInput) => Promise<void>;
  markDepositDone: (transactionId: string, executionBankProductId?: string) => Promise<void>;
  approveAccountantDeposit: (transactionId: string) => Promise<void>;
  requestEcash: (payload: {
    branchId: string;
    bankProductId?: string;
    amount: number;
    notes?: string;
  }) => Promise<void>;
  approveEcash: (requestId: string, approve?: boolean) => Promise<void>;
  saveManualEntries: (bankProductId: string, manualTotalEntries: number) => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const useBackOfficeStore = create<State>((set, get) => ({
  data: null,
  branchId: getRuntimeBranchId() || "",
  businessDate: todayIso(),
  loading: false,
  busyId: null,
  error: null,
  lastFetchedAt: null,
  liveSyncActive: false,
  executionAccountByDeposit: {},

  hydrate: (options) => {
    const branchId = options?.branchId ?? options?.fallbackBranchId ?? get().branchId;
    if (branchId) {
      set({ branchId });
      if (branchId !== "all") {
        setRuntimeBranchId(branchId);
      }
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
    const { branchId, businessDate } = get();
    if (!branchId) {
      set({ error: "Select a branch" });
      return;
    }
    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        const data = await getBackOfficeBootstrap({ branchId, date: businessDate });
        set({ data, lastFetchedAt: Date.now(), error: null });
      } catch (error) {
        set({ error: toUserFacingError(error, "Could not load back office") });
      } finally {
        set({ loading: false });
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  refreshSilent: async () => {
    if (fetchInFlight) return fetchInFlight;
    const { branchId, businessDate } = get();
    if (!branchId) return;
    fetchInFlight = (async () => {
      try {
        const data = await getBackOfficeBootstrap({ branchId, date: businessDate });
        set({ data, lastFetchedAt: Date.now(), error: null });
      } catch {
        /* keep cache */
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  setBranchId: (branchId) => {
    set({ branchId });
    if (branchId && branchId !== "all") {
      setRuntimeBranchId(branchId);
    }
    void get().refresh();
  },

  setBusinessDate: (date) => {
    set({ businessDate: date });
    void get().refresh();
  },

  setExecutionAccount: (depositId, bankProductId) => {
    set((s) => ({
      executionAccountByDeposit: { ...s.executionAccountByDeposit, [depositId]: bankProductId }
    }));
  },

  openDay: async (payload) => {
    set({ busyId: "open-day", error: null });
    try {
      const data = await openBackOfficeDay(payload);
      set({ data, lastFetchedAt: Date.now() });
    } catch (error) {
      set({ error: toUserFacingError(error, "Failed to open day") });
      throw error;
    } finally {
      set({ busyId: null });
    }
  },

  markDepositDone: async (transactionId, executionBankProductId) => {
    const explicit = executionBankProductId?.trim();
    const accountId = explicit || get().executionAccountByDeposit[transactionId]?.trim() || "";
    if (!accountId) {
      throw new Error("Select the company bank account used for this deposit");
    }
    set({ busyId: transactionId, error: null });
    try {
      await executeBackOfficeDepositDone(transactionId, accountId);
      await get().refreshSilent();
    } catch (error) {
      set({ error: toUserFacingError(error, "Failed to mark deposit done") });
      throw error;
    } finally {
      set({ busyId: null });
    }
  },

  approveAccountantDeposit: async (transactionId) => {
    set({ busyId: transactionId, error: null });
    try {
      const data = await approveBackOfficeAccountantDeposit(transactionId);
      set({ data, lastFetchedAt: Date.now() });
    } catch (error) {
      set({ error: toUserFacingError(error, "Approval failed") });
      throw error;
    } finally {
      set({ busyId: null });
    }
  },

  requestEcash: async (payload) => {
    set({ busyId: "ecash", error: null });
    try {
      const data = await createBackOfficeEcashRequest(payload);
      set({ data, lastFetchedAt: Date.now() });
    } catch (error) {
      set({ error: toUserFacingError(error, "Ecash request failed") });
      throw error;
    } finally {
      set({ busyId: null });
    }
  },

  approveEcash: async (requestId, approve = true) => {
    set({ busyId: requestId, error: null });
    try {
      const data = await approveBackOfficeEcashRequest(requestId, approve);
      set({ data, lastFetchedAt: Date.now() });
    } catch (error) {
      set({ error: toUserFacingError(error, "Ecash review failed") });
      throw error;
    } finally {
      set({ busyId: null });
    }
  },

  saveManualEntries: async (bankProductId, manualTotalEntries) => {
    set({ busyId: bankProductId, error: null });
    try {
      const data = await updateBackOfficeAccountEntries({ bankProductId, manualTotalEntries });
      set({ data, lastFetchedAt: Date.now() });
    } catch (error) {
      set({ error: toUserFacingError(error, "Failed to save entries") });
      throw error;
    } finally {
      set({ busyId: null });
    }
  },

  startLiveSync: () => {
    if (get().liveSyncActive) return;
    set({ liveSyncActive: true });
    liveSyncMgr.start({
      getTenantId,
      tables: [
        "customer_transactions",
        "back_office_day_sessions",
        "back_office_ecash_requests",
        "back_office_account_opening"
      ],
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
