import { create } from "zustand";
import type { PartnerBankAccount, TenantBankProduct } from "@bms/shared";
import {
  createPartnerBankAccount,
  getRuntimeBranchId,
  getTenantId,
  listAccountOpeningProducts,
  listPartnerBankAccounts
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type AgencyAccountsState = {
  accounts: PartnerBankAccount[];
  openingProducts: TenantBankProduct[];
  openingProductsLoading: boolean;
  openingProductsBranchId: string;
  openingProductsLastFetchedAt: number | null;
  loading: boolean;
  posting: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;
  hydrate: (options?: { force?: boolean }) => void;
  hydrateOpeningProducts: (options?: { force?: boolean; branchId?: string }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  refreshOpeningProducts: () => Promise<void>;
  refreshOpeningProductsSilent: () => Promise<void>;
  createAccount: (payload: {
    customerId?: string;
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
let openingProductsFetchInFlight: Promise<void> | null = null;
const silentScheduler = createSilentRefreshScheduler();
const openingProductsSilentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

export const useAgencyAccountsStore = create<AgencyAccountsState>((set, get) => ({
  accounts: [],
  openingProducts: [],
  openingProductsLoading: false,
  openingProductsBranchId: "",
  openingProductsLastFetchedAt: null,
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

  hydrateOpeningProducts: (options) => {
    const branchId = options?.branchId ?? getRuntimeBranchId() ?? get().openingProductsBranchId;
    if (branchId && branchId !== get().openingProductsBranchId) {
      set({ openingProductsBranchId: branchId, openingProductsLastFetchedAt: null });
    } else if (branchId) {
      set({ openingProductsBranchId: branchId });
    }
    const { openingProductsLoading, openingProductsLastFetchedAt } = get();
    runHydrate({
      force: options?.force,
      loading: openingProductsLoading,
      lastFetchedAt: openingProductsLastFetchedAt,
      refresh: () => get().refreshOpeningProducts(),
      refreshSilent: () => get().refreshOpeningProductsSilent(),
      scheduleSilent: (run) => openingProductsSilentScheduler.schedule(run)
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

  refreshOpeningProducts: async () => {
    if (openingProductsFetchInFlight) {
      set({ openingProductsLoading: true });
      await openingProductsFetchInFlight;
      set({ openingProductsLoading: false });
      return;
    }
    const branchId = get().openingProductsBranchId || getRuntimeBranchId() || "";
    set({ openingProductsLoading: true, error: null });
    openingProductsFetchInFlight = (async () => {
      try {
        const products = await listAccountOpeningProducts(
          branchId ? { branchId } : undefined
        );
        set({
          openingProducts: products,
          openingProductsLoading: false,
          openingProductsLastFetchedAt: Date.now(),
          openingProductsBranchId: branchId,
          error: null
        });
      } catch (error) {
        set({
          openingProductsLoading: false,
          openingProducts: [],
          error: toUserFacingError(error, "Could not load account-opening products")
        });
      } finally {
        openingProductsFetchInFlight = null;
      }
    })();
    await openingProductsFetchInFlight;
  },

  refreshOpeningProductsSilent: async () => {
    if (openingProductsFetchInFlight) {
      return openingProductsFetchInFlight;
    }
    const branchId = get().openingProductsBranchId || getRuntimeBranchId() || "";
    openingProductsFetchInFlight = (async () => {
      try {
        const products = await listAccountOpeningProducts(
          branchId ? { branchId } : undefined
        );
        set({
          openingProducts: products,
          openingProductsLastFetchedAt: Date.now(),
          openingProductsBranchId: branchId,
          error: null
        });
      } catch {
        /* keep cache */
      } finally {
        openingProductsFetchInFlight = null;
      }
    })();
    return openingProductsFetchInFlight;
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
      tables: ["customer_partner_bank_accounts", "tenant_bank_products"],
      onRefresh: () => {
        void get().refreshSilent();
        void get().refreshOpeningProductsSilent();
      },
      isStale: () =>
        !isFresh(get().lastFetchedAt) || !isFresh(get().openingProductsLastFetchedAt)
    });
  },

  stopLiveSync: () => {
    if (!get().liveSyncActive) {
      return;
    }
    liveSync.stop();
    silentScheduler.clear();
    openingProductsSilentScheduler.clear();
    set({ liveSyncActive: false });
  }
}));
