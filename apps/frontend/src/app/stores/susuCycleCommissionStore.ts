import { create } from "zustand";
import type {
  SusuCommissionPolicy,
  SusuCustomerCycleSummary,
  UpdateSusuCommissionPolicyInput
} from "@bms/shared";
import {
  getCustomerSusuCycleSummary,
  getSusuCycleCommissionPolicy,
  getTenantId,
  updateSusuCycleCommissionPolicy
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

const PASSBOOK_STALE_MS = 60_000;

type State = {
  policy: SusuCommissionPolicy | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;

  summaryByCustomer: Record<string, SusuCustomerCycleSummary>;
  summaryFetchedAt: Record<string, number>;
  summaryLoadingByCustomer: Record<string, boolean>;
  summaryErrorByCustomer: Record<string, string | null>;
  passbookLiveSyncActive: boolean;

  setPolicy: (policy: SusuCommissionPolicy) => void;
  setSaving: (saving: boolean) => void;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  save: (input: UpdateSusuCommissionPolicyInput) => Promise<SusuCommissionPolicy>;
  startLiveSync: () => void;
  stopLiveSync: () => void;

  ensureCustomerPassbook: (customerId: string, options?: { force?: boolean }) => Promise<void>;
  refreshCustomerPassbookSilent: (customerId: string) => Promise<void>;
  invalidateCustomerPassbook: (customerId?: string) => void;
  startPassbookLiveSync: (customerId: string) => void;
  stopPassbookLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;
const passbookInFlight = new Map<string, Promise<void>>();
let watchedPassbookCustomerId: string | null = null;

const silentScheduler = createSilentRefreshScheduler();
const passbookSilentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();
const passbookLiveSync = createLiveSyncManager();

export const useSusuCycleCommissionStore = create<State>((set, get) => ({
  policy: null,
  loading: false,
  saving: false,
  error: null,
  lastFetchedAt: null,
  liveSyncActive: false,

  summaryByCustomer: {},
  summaryFetchedAt: {},
  summaryLoadingByCustomer: {},
  summaryErrorByCustomer: {},
  passbookLiveSyncActive: false,

  setPolicy: (policy) => set({ policy }),
  setSaving: (saving) => set({ saving }),

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

  refresh: async () => {
    if (fetchInFlight) {
      return fetchInFlight;
    }
    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        const policy = await getSusuCycleCommissionPolicy();
        set({ policy, loading: false, lastFetchedAt: Date.now(), error: null });
      } catch (error) {
        set({
          loading: false,
          error: toUserFacingError(error, "Could not load Susu cycle fee policy")
        });
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  refreshSilent: async () => {
    if (fetchInFlight) {
      return fetchInFlight;
    }
    fetchInFlight = (async () => {
      try {
        const policy = await getSusuCycleCommissionPolicy();
        set({ policy, lastFetchedAt: Date.now(), error: null });
      } catch {
        /* keep */
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  save: async (input) => {
    set({ saving: true, error: null });
    try {
      const policy = await updateSusuCycleCommissionPolicy(input);
      set({ policy, saving: false, lastFetchedAt: Date.now() });
      return policy;
    } catch (error) {
      set({
        saving: false,
        error: toUserFacingError(error, "Could not save Susu cycle fee policy")
      });
      throw error;
    }
  },

  startLiveSync: () => {
    if (get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: ["susu_commission_policies", "susu_customer_cycles"],
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt)
    });
  },

  stopLiveSync: () => {
    if (!get().liveSyncActive) {
      return;
    }
    liveSync.stop();
    set({ liveSyncActive: false });
  },

  ensureCustomerPassbook: async (customerId, options) => {
    if (!customerId) {
      return;
    }
    watchedPassbookCustomerId = customerId;
    const force = options?.force ?? false;
    const fetchedAt = get().summaryFetchedAt[customerId];
    const cached = get().summaryByCustomer[customerId];
    if (!force && cached && fetchedAt && Date.now() - fetchedAt < PASSBOOK_STALE_MS) {
      return;
    }
    const existing = passbookInFlight.get(customerId);
    if (existing) {
      return existing;
    }
    if (!cached) {
      set((state) => ({
        summaryLoadingByCustomer: { ...state.summaryLoadingByCustomer, [customerId]: true },
        summaryErrorByCustomer: { ...state.summaryErrorByCustomer, [customerId]: null }
      }));
    }
    const flight = (async () => {
      try {
        const summary = await getCustomerSusuCycleSummary(customerId);
        set((state) => ({
          summaryByCustomer: { ...state.summaryByCustomer, [customerId]: summary },
          summaryFetchedAt: { ...state.summaryFetchedAt, [customerId]: Date.now() },
          summaryErrorByCustomer: { ...state.summaryErrorByCustomer, [customerId]: null }
        }));
      } catch (error) {
        set((state) => ({
          summaryErrorByCustomer: {
            ...state.summaryErrorByCustomer,
            [customerId]: toUserFacingError(error, "Could not load Susu passbook")
          }
        }));
      } finally {
        set((state) => ({
          summaryLoadingByCustomer: { ...state.summaryLoadingByCustomer, [customerId]: false }
        }));
        passbookInFlight.delete(customerId);
      }
    })();
    passbookInFlight.set(customerId, flight);
    return flight;
  },

  refreshCustomerPassbookSilent: async (customerId) => {
    if (!customerId || passbookInFlight.has(customerId)) {
      return;
    }
    const flight = (async () => {
      try {
        const summary = await getCustomerSusuCycleSummary(customerId);
        set((state) => ({
          summaryByCustomer: { ...state.summaryByCustomer, [customerId]: summary },
          summaryFetchedAt: { ...state.summaryFetchedAt, [customerId]: Date.now() },
          summaryErrorByCustomer: { ...state.summaryErrorByCustomer, [customerId]: null }
        }));
      } catch {
        /* keep last good passbook snapshot */
      } finally {
        passbookInFlight.delete(customerId);
      }
    })();
    passbookInFlight.set(customerId, flight);
    return flight;
  },

  invalidateCustomerPassbook: (customerId) => {
    if (!customerId) {
      set({ summaryFetchedAt: {} });
      return;
    }
    set((state) => {
      const next = { ...state.summaryFetchedAt };
      delete next[customerId];
      return { summaryFetchedAt: next };
    });
  },

  startPassbookLiveSync: (customerId) => {
    watchedPassbookCustomerId = customerId;
    if (get().passbookLiveSyncActive) {
      return;
    }
    set({ passbookLiveSyncActive: true });
    passbookLiveSync.start({
      getTenantId,
      tables: ["susu_customer_cycles", "customer_transactions", "susu_commission_policies"],
      onRefresh: () => {
        const id = watchedPassbookCustomerId;
        if (!id) {
          return;
        }
        passbookSilentScheduler.schedule(() => {
          void get().refreshCustomerPassbookSilent(id);
        });
      },
      isStale: () => {
        const id = watchedPassbookCustomerId;
        if (!id) {
          return false;
        }
        return !isFresh(get().summaryFetchedAt[id] ?? null, PASSBOOK_STALE_MS);
      }
    });
  },

  stopPassbookLiveSync: () => {
    passbookLiveSync.stop();
    passbookSilentScheduler.clear();
    if (get().passbookLiveSyncActive) {
      set({ passbookLiveSyncActive: false });
    }
  }
}));
