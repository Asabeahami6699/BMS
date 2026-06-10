import { create } from "zustand";
import type {
  BankProductCreateDirection,
  BankProductDirection,
  BankProductWorkflowField,
  TenantBankProduct
} from "@bms/shared";
import {
  COMPANY_ACCOUNT_DEFAULT_EXECUTION_LIMIT,
  STANDARD_DEPOSIT_EXECUTION_FIELDS
} from "@bms/shared";
import {
  createBankProduct,
  getActiveBranchFilter,
  getTenantId,
  listBankProducts,
  updateBankProduct
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

export type BankProductFormDraft = {
  name: string;
  code: string;
  direction: BankProductCreateDirection;
  bankLabel: string;
  branchId: string;
  sortOrder: string;
  isActive: boolean;
  workflowFields: BankProductWorkflowField[];
  isCompanyBankAccount: boolean;
  executionLimitAmount: string;
};

export const emptyBankProductFormDraft = (): BankProductFormDraft => ({
  name: "",
  code: "",
  direction: "both",
  bankLabel: "",
  branchId: "",
  sortOrder: "0",
  isActive: true,
  workflowFields: [],
  isCompanyBankAccount: false,
  executionLimitAmount: ""
});

type BankProductsState = {
  products: TenantBankProduct[];
  branchFilter: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;
  formOpen: boolean;
  editingId: string | null;
  formDraft: BankProductFormDraft;
  companyAccountModalOpen: boolean;
  editingCompanyAccount: TenantBankProduct | null;

  setBranchFilter: (branchId: string) => void;
  syncBranchContextFromNav: () => void;
  openCreateForm: () => void;
  openCompanyAccountModal: () => void;
  openEditCompanyAccountModal: (product: TenantBankProduct) => void;
  closeCompanyAccountModal: () => void;
  openEditForm: (product: TenantBankProduct) => void;
  closeForm: () => void;
  patchFormDraft: (patch: Partial<BankProductFormDraft>) => void;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  createCompanyAccount: (payload: {
    name: string;
    bankLabel: string;
    executionLimitAmount: number;
    branchId?: string | null;
  }) => Promise<TenantBankProduct[]>;
  createProduct: (payload: {
    name: string;
    code?: string;
    direction: BankProductCreateDirection;
    bankLabel: string;
    branchId?: string | null;
    isActive?: boolean;
    sortOrder?: number;
    workflowFields?: BankProductWorkflowField[];
    isCompanyBankAccount?: boolean;
    executionLimitAmount?: number | null;
  }) => Promise<TenantBankProduct[]>;
  updateProduct: (
    productId: string,
    payload: Partial<{
      name: string;
      code: string;
      direction: TenantBankProduct["direction"];
      bankLabel: string;
      branchId: string | null;
      isActive: boolean;
      sortOrder: number;
      workflowFields: BankProductWorkflowField[];
      isCompanyBankAccount: boolean;
      executionLimitAmount: number | null;
    }>
  ) => Promise<TenantBankProduct>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

export const useBankProductsStore = create<BankProductsState>((set, get) => ({
  products: [],
  branchFilter: "",
  loading: false,
  saving: false,
  error: null,
  lastFetchedAt: null,
  liveSyncActive: false,
  formOpen: false,
  editingId: null,
  formDraft: emptyBankProductFormDraft(),
  companyAccountModalOpen: false,
  editingCompanyAccount: null,

  openCreateForm: () => {
    set({ formOpen: true, editingId: null, formDraft: emptyBankProductFormDraft() });
  },

  openCompanyAccountModal: () => {
    set({ companyAccountModalOpen: true, editingCompanyAccount: null });
  },

  openEditCompanyAccountModal: (product) => {
    set({ companyAccountModalOpen: true, editingCompanyAccount: product });
  },

  closeCompanyAccountModal: () => {
    set({ companyAccountModalOpen: false, editingCompanyAccount: null });
  },

  openEditForm: (product) => {
    set({
      formOpen: true,
      editingId: product.id,
      formDraft: {
        name: product.name,
        code: product.code,
        direction: product.direction,
        bankLabel: product.bankLabel,
        branchId: product.branchId ?? "",
        sortOrder: String(product.sortOrder),
        isActive: product.isActive,
        workflowFields: product.workflowFields ?? [],
        isCompanyBankAccount: product.isCompanyBankAccount ?? false,
        executionLimitAmount:
          product.executionLimitAmount != null ? String(product.executionLimitAmount) : ""
      }
    });
  },

  closeForm: () => {
    set({ formOpen: false, editingId: null, formDraft: emptyBankProductFormDraft() });
  },

  patchFormDraft: (patch) => {
    set((state) => {
      const next = { ...state.formDraft, ...patch };
      if (patch.isCompanyBankAccount === true && !next.executionLimitAmount.trim()) {
        next.executionLimitAmount = String(COMPANY_ACCOUNT_DEFAULT_EXECUTION_LIMIT);
      }
      return { formDraft: next };
    });
  },

  setBranchFilter: (branchId) => {
    set({ branchFilter: branchId, products: [], lastFetchedAt: null });
    void get().refresh();
  },

  syncBranchContextFromNav: () => {
    const navBranch = getActiveBranchFilter() ?? "";
    if (get().branchFilter === navBranch) {
      void get().refresh();
      return;
    }
    set({ branchFilter: navBranch, products: [], lastFetchedAt: null });
    void get().refresh();
  },

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
    const branchFilter = get().branchFilter || getActiveBranchFilter() || "";
    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        const products = await listBankProducts(
          branchFilter ? { branchId: branchFilter } : undefined
        );
        set({ products, loading: false, lastFetchedAt: Date.now(), error: null });
      } catch (error) {
        set({
          loading: false,
          error: toUserFacingError(error, "Could not load bank products")
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
    const branchFilter = get().branchFilter || getActiveBranchFilter() || "";
    fetchInFlight = (async () => {
      try {
        const products = await listBankProducts(
          branchFilter ? { branchId: branchFilter } : undefined
        );
        set({ products, lastFetchedAt: Date.now(), error: null });
      } catch {
        // Keep stale data on silent refresh failure
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  createCompanyAccount: async (payload) => {
    set({ saving: true, error: null });
    try {
      const created = await createBankProduct({
        name: payload.name,
        bankLabel: payload.bankLabel,
        direction: "deposit",
        branchId: payload.branchId ? payload.branchId : null,
        isCompanyBankAccount: true,
        executionLimitAmount: payload.executionLimitAmount,
        workflowFields: [...STANDARD_DEPOSIT_EXECUTION_FIELDS],
        sortOrder: 0,
        isActive: true
      });
      set((state) => ({
        products: [...created, ...state.products],
        saving: false,
        lastFetchedAt: Date.now()
      }));
      return created;
    } catch (error) {
      const message = toUserFacingError(error, "Could not create company account");
      set({ saving: false, error: message });
      throw error;
    }
  },

  createProduct: async (payload) => {
    set({ saving: true, error: null });
    try {
      const created = await createBankProduct(payload);
      set((state) => ({
        products: [...created, ...state.products],
        saving: false,
        lastFetchedAt: Date.now()
      }));
      return created;
    } catch (error) {
      const message = toUserFacingError(error, "Could not create bank product");
      set({ saving: false, error: message });
      throw error;
    }
  },

  updateProduct: async (productId, payload) => {
    set({ saving: true, error: null });
    try {
      const updated = await updateBankProduct(productId, payload);
      set((state) => ({
        products: state.products.map((row) => (row.id === productId ? updated : row)),
        saving: false,
        lastFetchedAt: Date.now()
      }));
      return updated;
    } catch (error) {
      const message = toUserFacingError(error, "Could not update bank product");
      set({ saving: false, error: message });
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
      tables: ["tenant_bank_products"],
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
