import { create } from "zustand";
import type { TellerTillEntryType, TellerTillJournalEntry } from "@bms/shared";
import {
  createTellerTillJournalEntry,
  getRuntimeBranchId,
  getTenantId,
  listTellerTillJournalEntries
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

const STALE_MS = 20_000;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type TellerTillDaybookState = {
  entries: TellerTillJournalEntry[];
  businessDate: string;
  branchId: string;
  loading: boolean;
  posting: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;

  hydrate: (options?: { force?: boolean; branchId?: string; date?: string }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  setBusinessDate: (date: string) => void;
  syncBranchFromRuntime: () => void;
  postEntry: (payload: {
    entryType: TellerTillEntryType;
    amount: number;
    notes?: string;
  }) => Promise<TellerTillJournalEntry>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

export const useTellerTillDaybookStore = create<TellerTillDaybookState>((set, get) => ({
  entries: [],
  businessDate: todayIso(),
  branchId: getRuntimeBranchId() ?? "",
  loading: false,
  posting: false,
  error: null,
  lastFetchedAt: null,
  liveSyncActive: false,

  hydrate: (options) => {
    const branchId = options?.branchId ?? getRuntimeBranchId() ?? get().branchId;
    if (branchId && branchId !== get().branchId) {
      set({ branchId });
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

  syncBranchFromRuntime: () => {
    const branchId = getRuntimeBranchId() ?? "";
    if (branchId && branchId !== get().branchId) {
      set({ branchId });
      void get().refresh();
    }
  },

  setBusinessDate: (date) => {
    if (date === get().businessDate) {
      return;
    }
    set({ businessDate: date });
    void get().refresh();
  },

  refresh: async () => {
    if (fetchInFlight) {
      set({ loading: true });
      await fetchInFlight;
      set({ loading: false });
      return;
    }

    const { branchId, businessDate } = get();
    if (!branchId) {
      set({ entries: [], loading: false, error: null, lastFetchedAt: Date.now() });
      return;
    }

    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        const entries = await listTellerTillJournalEntries({
          branchId,
          date: businessDate
        });
        set({
          entries,
          loading: false,
          lastFetchedAt: Date.now(),
          error: null
        });
      } catch (error) {
        set({
          loading: false,
          entries: [],
          error: toUserFacingError(error, "Could not load till daybook")
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
    const { branchId, businessDate } = get();
    if (!branchId) {
      return;
    }
    fetchInFlight = (async () => {
      try {
        const entries = await listTellerTillJournalEntries({
          branchId,
          date: businessDate
        });
        set({ entries, lastFetchedAt: Date.now(), error: null });
      } catch {
        /* keep cache */
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  postEntry: async (payload) => {
    const { branchId, businessDate } = get();
    if (!branchId) {
      throw new Error("Select a branch first");
    }
    set({ posting: true, error: null });
    try {
      const entry = await createTellerTillJournalEntry({
        branchId,
        businessDate,
        entryType: payload.entryType,
        amount: payload.amount,
        notes: payload.notes
      });
      await get().refreshSilent();
      set({ posting: false });
      return entry;
    } catch (error) {
      const message = toUserFacingError(error, "Failed to record movement");
      set({ posting: false, error: message });
      throw new Error(message);
    }
  },

  startLiveSync: () => {
    if (get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: ["teller_till_journal_entries", "branch_float_sessions"],
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt, STALE_MS)
    });
  },

  stopLiveSync: () => {
    liveSync.stop();
    silentScheduler.clear();
    set({ liveSyncActive: false });
  }
}));
