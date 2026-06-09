import { create } from "zustand";
import type { PartnerBankAccount } from "@bms/shared";
import { createPartnerBankAccount, getTenantId, listPartnerBankAccounts } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type AgencyAccountsState = {
  accounts: PartnerBankAccount[];
  loading: boolean;
  posting: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  createAccount: (payload: {
    customerId: string;
    bankProductId: string;
    accountNumber: string;
    accountName: string;
    branchId?: string;
    externalReference?: string;
    workflowData?: Record<string, unknown>;
  }) => Promise<PartnerBankAccount>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

export const useAgencyAccountsStore = create<AgencyAccountsState>((set, get) => ({
  accounts: [],
  loading: false,
  posting: false,
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

  refresh: async () => {
    if (fetchInFlight) {
      return fetchInFlight;
    }
    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        const accounts = await listPartnerBankAccounts();
        set({ accounts, loading: false, lastFetchedAt: Date.now(), error: null });
      } catch (error) {
        set({ loading: false, error: toUserFacingError(error, "Could not load partner accounts") });
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
        const accounts = await listPartnerBankAccounts();
        set({ accounts, lastFetchedAt: Date.now(), error: null });
      } catch {
        /* keep cache */
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  createAccount: async (payload) => {
    set({ posting: true, error: null });
    try {
      const account = await createPartnerBankAccount(payload);
      set((state) => ({
        accounts: [account, ...state.accounts],
        posting: false,
        lastFetchedAt: Date.now()
      }));
      return account;
    } catch (error) {
      set({ posting: false, error: toUserFacingError(error, "Account creation failed") });
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
      tables: ["customer_partner_bank_accounts"],
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
  }
}));
