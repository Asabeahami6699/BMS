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

type DraftFields = {
  openingVault: string;
  cashToBank: string;
  susuExpenses: string;
  closingVaultCounted: string;
  notes: string;
};

type PersistedSelection = {
  branchId: string;
  businessDate: string;
};

function selectionStorageKey(): string {
  return `bms:susu-closing:selection:${getTenantId() || "default"}`;
}

function draftStorageKey(branchId: string, businessDate: string): string {
  return `bms:susu-closing:draft:${getTenantId() || "default"}:${branchId}:${businessDate}`;
}

function loadPersistedSelection(): Partial<PersistedSelection> {
  try {
    const raw = window.sessionStorage.getItem(selectionStorageKey());
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Partial<PersistedSelection>;
    const businessDate =
      typeof parsed.businessDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.businessDate)
        ? parsed.businessDate
        : undefined;
    const branchId = typeof parsed.branchId === "string" ? parsed.branchId : undefined;
    return { branchId, businessDate };
  } catch {
    return {};
  }
}

function persistSelection(branchId: string, businessDate: string): void {
  try {
    window.sessionStorage.setItem(
      selectionStorageKey(),
      JSON.stringify({ branchId, businessDate })
    );
  } catch {
    // Ignore storage quota / private mode failures.
  }
}

function loadPersistedDraft(branchId: string, businessDate: string): DraftFields | null {
  if (!branchId || !businessDate) {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(draftStorageKey(branchId, businessDate));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<DraftFields>;
    if (typeof parsed.openingVault !== "string") {
      return null;
    }
    return {
      openingVault: parsed.openingVault,
      cashToBank: typeof parsed.cashToBank === "string" ? parsed.cashToBank : "0",
      susuExpenses: typeof parsed.susuExpenses === "string" ? parsed.susuExpenses : "0",
      closingVaultCounted:
        typeof parsed.closingVaultCounted === "string" ? parsed.closingVaultCounted : "",
      notes: typeof parsed.notes === "string" ? parsed.notes : ""
    };
  } catch {
    return null;
  }
}

function persistDraft(branchId: string, businessDate: string, draft: DraftFields): void {
  if (!branchId || !businessDate) {
    return;
  }
  try {
    window.sessionStorage.setItem(draftStorageKey(branchId, businessDate), JSON.stringify(draft));
  } catch {
    // Ignore storage errors.
  }
}

function clearPersistedDraft(branchId: string, businessDate: string): void {
  if (!branchId || !businessDate) {
    return;
  }
  try {
    window.sessionStorage.removeItem(draftStorageKey(branchId, businessDate));
  } catch {
    // Ignore storage errors.
  }
}

function applyDraftFromSnapshot(snapshot: SusuClosingBalanceSnapshot): DraftFields {
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
  dirty: boolean;
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
let fetchInFlightKey = "";
let activeRequestSeq = 0;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

const initialSelection = typeof window !== "undefined" ? loadPersistedSelection() : {};

export const useSusuClosingBalancesStore = create<SusuClosingBalancesState>((set, get) => {
  function updateDraftField(patch: Partial<DraftFields>) {
    set((state) => {
      const next: DraftFields = {
        openingVault: patch.openingVault ?? state.openingVault,
        cashToBank: patch.cashToBank ?? state.cashToBank,
        susuExpenses: patch.susuExpenses ?? state.susuExpenses,
        closingVaultCounted: patch.closingVaultCounted ?? state.closingVaultCounted,
        notes: patch.notes ?? state.notes
      };
      persistDraft(state.branchId, state.businessDate, next);
      return { ...next, dirty: true };
    });
  }

  return {
    branches: [],
    branchId: initialSelection.branchId ?? "",
    businessDate: initialSelection.businessDate ?? todayIso(),
    snapshot: null,
    openingVault: "",
    cashToBank: "",
    susuExpenses: "",
    closingVaultCounted: "",
    notes: "",
    dirty: false,
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
      const businessDate = get().businessDate;
      persistSelection(branchId, businessDate);
      set({ branchId, dirty: false });
      void get().refresh();
    },

    setBusinessDate: (date) => {
      if (!date || date === get().businessDate) {
        return;
      }
      const branchId = get().branchId;
      persistSelection(branchId, date);
      set({ businessDate: date, dirty: false });
      void get().refresh();
    },

    setOpeningVault: (value) => updateDraftField({ openingVault: value }),
    setCashToBank: (value) => updateDraftField({ cashToBank: value }),
    setSusuExpenses: (value) => updateDraftField({ susuExpenses: value }),
    setClosingVaultCounted: (value) => updateDraftField({ closingVaultCounted: value }),
    setNotes: (value) => updateDraftField({ notes: value }),

    resetFromSuggestion: () => {
      const { snapshot, branchId, businessDate } = get();
      if (!snapshot) {
        return;
      }
      clearPersistedDraft(branchId, businessDate);
      set({
        openingVault: String(snapshot.suggestedOpeningVault),
        cashToBank: "0",
        susuExpenses: String(snapshot.tillExpenses),
        closingVaultCounted: "",
        dirty: true
      });
      persistDraft(branchId, businessDate, {
        openingVault: String(snapshot.suggestedOpeningVault),
        cashToBank: "0",
        susuExpenses: String(snapshot.tillExpenses),
        closingVaultCounted: "",
        notes: get().notes
      });
    },

    refresh: async () => {
      const initial = get();
      const targetKey = `${initial.branchId}::${initial.businessDate}`;
      if (fetchInFlight && fetchInFlightKey === targetKey && initial.branchId) {
        set({ loading: true });
        await fetchInFlight;
        set({ loading: false });
        return;
      }

      const reqSeq = ++activeRequestSeq;
      set({ loading: true, error: null });

      const job = (async () => {
        try {
          let { branchId, businessDate, branches } = get();

          if (branches.length === 0) {
            const rows = await listBranches();
            branches = rows.filter((b) => b.status !== "inactive");
            set({ branches });
          }

          if (!branchId || !branches.some((b) => b.id === branchId)) {
            branchId = branches[0]?.id ?? "";
            set({ branchId });
          }

          if (!branchId) {
            if (reqSeq === activeRequestSeq) {
              set({
                snapshot: null,
                loading: false,
                lastFetchedAt: Date.now(),
                error: null
              });
            }
            return;
          }

          persistSelection(branchId, businessDate);
          fetchInFlightKey = `${branchId}::${businessDate}`;

          const snapshot = await getSusuClosingBalance(branchId, businessDate);
          if (reqSeq !== activeRequestSeq) {
            return;
          }

          const savedDraft = loadPersistedDraft(branchId, businessDate);
          if (savedDraft) {
            set({
              snapshot,
              ...savedDraft,
              dirty: true,
              loading: false,
              lastFetchedAt: Date.now(),
              error: null
            });
          } else {
            set({
              snapshot,
              ...applyDraftFromSnapshot(snapshot),
              dirty: false,
              loading: false,
              lastFetchedAt: Date.now(),
              error: null
            });
          }
        } catch (error) {
          if (reqSeq === activeRequestSeq) {
            set({
              loading: false,
              snapshot: null,
              error: toUserFacingError(error, "Failed to load closing balance")
            });
          }
        } finally {
          if (reqSeq === activeRequestSeq) {
            fetchInFlight = null;
            fetchInFlightKey = "";
          }
        }
      })();

      fetchInFlight = job;
      fetchInFlightKey = targetKey;
      await job;
    },

    refreshSilent: async () => {
      const { branchId, businessDate } = get();
      if (!branchId) {
        return;
      }
      const targetKey = `${branchId}::${businessDate}`;
      if (fetchInFlight && fetchInFlightKey === targetKey) {
        return fetchInFlight;
      }
      const reqSeq = ++activeRequestSeq;
      const job = (async () => {
        try {
          const snapshot = await getSusuClosingBalance(branchId, businessDate);
          if (reqSeq !== activeRequestSeq) {
            return;
          }
          const current = get();
          if (current.dirty) {
            // Preserve user's unsaved form edits while refreshing live KPIs & till rollups.
            set({
              snapshot,
              lastFetchedAt: Date.now(),
              error: null
            });
          } else {
            set({
              snapshot,
              ...applyDraftFromSnapshot(snapshot),
              lastFetchedAt: Date.now(),
              error: null
            });
          }
        } catch {
          // Keep stale draft on silent failure.
        } finally {
          if (reqSeq === activeRequestSeq) {
            fetchInFlight = null;
            fetchInFlightKey = "";
          }
        }
      })();
      fetchInFlight = job;
      fetchInFlightKey = targetKey;
      return job;
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
        clearPersistedDraft(state.branchId, state.businessDate);
        set({
          snapshot: saved,
          ...applyDraftFromSnapshot(saved),
          dirty: false,
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
  };
});

export function prefetchSusuClosingBalances(): void {
  useSusuClosingBalancesStore.getState().hydrate();
}
