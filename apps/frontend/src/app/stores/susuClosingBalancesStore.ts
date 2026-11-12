import { create } from "zustand";
import type { Branch, SusuClosingBalanceSnapshot } from "../api";
import {
  getSusuClosingBalance,
  getTenantId,
  listBranches,
  saveSusuClosingBalance
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  runHydrate
} from "./storeSync";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function applyDraftFromSnapshot(snapshot: SusuClosingBalanceSnapshot) {
  return {
    openingVault: String(snapshot.openingVault),
    cashToBank: String(snapshot.cashToBank),
    susuExpenses: String(snapshot.susuExpenses),
    closingVaultCounted:
      snapshot.closingVaultCounted != null ? String(snapshot.closingVaultCounted) : "",
    notes: snapshot.notes ?? ""
  };
}

type SusuClosingBalancesState = {
  branches: Branch[];
  branchId: string;
  businessDate: string;
  snapshot: SusuClosingBalanceSnapshot | null;
  openingVault: string;
  cashToBank: string;
  susuExpenses: string;
  closingVaultCounted: string;
  notes: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;

  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;

  setBranchId: (branchId: string) => void;
  setBusinessDate: (date: string) => void;
  setOpeningVault: (value: string) => void;
  setCashToBank: (value: string) => void;
  setSusuExpenses: (value: string) => void;
  setClosingVaultCounted: (value: string) => void;
  setNotes: (value: string) => void;
  resetFromSuggestion: () => void;
  save: () => Promise<SusuClosingBalanceSnapshot>;
};

let fetchInFlight: Promise<void> | null = null;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

export const useSusuClosingBalancesStore = create<SusuClosingBalancesState>((set, get) => ({
  branches: [],
  branchId: "",
  businessDate: todayIso(),
  snapshot: null,
  openingVault: "",
  cashToBank: "",
  susuExpenses: "",
  closingVaultCounted: "",
  notes: "",
  loading: false,
  saving: false,
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

  setBranchId: (branchId) => {
    if (branchId === get().branchId) {
      return;
    }
    set({ branchId });
    void get().refresh();
  },

  setBusinessDate: (date) => {
    if (date === get().businessDate) {
      return;
    }
    set({ businessDate: date });
    void get().refresh();
  },

  setOpeningVault: (value) => set({ openingVault: value }),
  setCashToBank: (value) => set({ cashToBank: value }),
  setSusuExpenses: (value) => set({ susuExpenses: value }),
  setClosingVaultCounted: (value) => set({ closingVaultCounted: value }),
  setNotes: (value) => set({ notes: value }),

  resetFromSuggestion: () => {
    const { snapshot } = get();
    if (!snapshot) {
      return;
    }
    set({
      openingVault: String(snapshot.suggestedOpeningVault),
      cashToBank: "0",
      susuExpenses: String(snapshot.tillExpenses),
      closingVaultCounted: ""
    });
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
        let { branchId, businessDate, branches } = get();

        if (branches.length === 0) {
          const rows = await listBranches();
          branches = rows.filter((b) => b.status !== "inactive");
          set({ branches });
        }

        if (!branchId) {
          branchId = branches[0]?.id ?? "";
          set({ branchId });
        }

        if (!branchId) {
          set({
            snapshot: null,
            loading: false,
            lastFetchedAt: Date.now(),
            error: null
          });
          return;
        }

        const snapshot = await getSusuClosingBalance(branchId, businessDate);
        set({
          snapshot,
          ...applyDraftFromSnapshot(snapshot),
          loading: false,
          lastFetchedAt: Date.now(),
          error: null
        });
      } catch (error) {
        set({
          loading: false,
          snapshot: null,
          error: toUserFacingError(error, "Failed to load closing balance")
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
        const snapshot = await getSusuClosingBalance(branchId, businessDate);
        set({
          snapshot,
          ...applyDraftFromSnapshot(snapshot),
          lastFetchedAt: Date.now(),
          error: null
        });
      } catch {
        // Keep stale draft on silent failure.
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
      tables: ["susu_daily_closing_records", "branch_float_sessions", "customer_transactions"],
      onRefresh: () => void get().refreshSilent()
    });
  },

  stopLiveSync: () => {
    liveSync.stop();
    silentScheduler.clear();
    set({ liveSyncActive: false });
  },

  save: async () => {
    const state = get();
    if (!state.branchId) {
      throw new Error("Select a branch");
    }
    set({ saving: true, error: null });
    try {
      const countedRaw = state.closingVaultCounted.trim();
      const saved = await saveSusuClosingBalance({
        branchId: state.branchId,
        businessDate: state.businessDate,
        openingVault: Number(state.openingVault) || 0,
        cashToBank: Number(state.cashToBank) || 0,
        susuExpenses: Number(state.susuExpenses) || 0,
        closingVaultCounted: countedRaw === "" ? null : Number(countedRaw) || 0,
        initialCash: state.snapshot?.tillPhysicalCash,
        notes: state.notes.trim() || undefined
      });
      set({
        snapshot: saved,
        ...applyDraftFromSnapshot(saved),
        saving: false,
        lastFetchedAt: Date.now(),
        error: null
      });
      return saved;
    } catch (error) {
      const message = toUserFacingError(error, "Failed to save");
      set({ saving: false, error: message });
      throw new Error(message);
    }
  }
}));

export function prefetchSusuClosingBalances(): void {
  useSusuClosingBalancesStore.getState().hydrate();
}
