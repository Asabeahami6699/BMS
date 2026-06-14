import { create } from "zustand";
import type { TenantBankProduct, TellerDepositStatus, UpdateTellerAgencyDepositInput } from "@bms/shared";
import type { Branch, Customer, LedgerEntry } from "../api";
import {
  cancelTellerAgencyDeposit,
  createTransaction,
  getAgencyWalkInCustomer,
  getBranchCounterBootstrap,
  getCustomerLedger,
  getRuntimeBranchId,
  getTenantId,
  getTellerAgencyDeposits,
  setRuntimeBranchId,
  updateTellerAgencyDeposit
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

const LEDGER_STALE_MS = 45_000;
const silentScheduler = createSilentRefreshScheduler();
const liveSyncMgr = createLiveSyncManager();

type AgencyTellerState = {
  customers: Customer[];
  branches: Branch[];
  bankProducts: TenantBankProduct[];
  transactionBranchId: string;
  selectedCustomerId: string;
  ledgerByCustomer: Record<string, LedgerEntry[]>;
  ledgerFetchedAt: Record<string, number>;
  recentDeposits: TellerDepositStatus[];
  depositsBusinessDate: string;
  loading: boolean;
  depositsLoading: boolean;
  posting: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;
  walkInCustomerIdByBranch: Record<string, string>;

  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  setTransactionBranchId: (branchId: string) => void;
  selectCustomer: (customerId: string) => void;
  loadLedger: (customerId: string, options?: { force?: boolean }) => Promise<void>;
  postDeposit: (payload: {
    customerId?: string;
    amount: number;
    transactionBranchId: string;
    notes?: string;
    bankProductId?: string;
    workflowData?: Record<string, unknown>;
    manualPartnerAccount?: boolean;
  }) => Promise<void>;
  refreshDeposits: () => Promise<void>;
  updatePendingDeposit: (
    transactionId: string,
    payload: UpdateTellerAgencyDepositInput
  ) => Promise<TellerDepositStatus>;
  cancelPendingDeposit: (transactionId: string, reason: string) => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveBranchId(stored: string, branches: Branch[]): string {
  if (stored && branches.some((b) => b.id === stored)) {
    return stored;
  }
  const runtime = getRuntimeBranchId();
  if (runtime && branches.some((b) => b.id === runtime)) {
    return runtime;
  }
  return branches[0]?.id ?? "";
}

function filterDepositProducts(products: TenantBankProduct[]): TenantBankProduct[] {
  return products.filter((p) => p.direction === "deposit" && p.isActive && !p.isCompanyBankAccount);
}

async function loadDepositsForBranch(branchId: string, date: string) {
  if (!branchId) {
    return null;
  }
  return getTellerAgencyDeposits({ branchId, date }).catch(() => null);
}

export const useAgencyTellerStore = create<AgencyTellerState>((set, get) => ({
  customers: [],
  branches: [],
  bankProducts: [],
  transactionBranchId: "",
  selectedCustomerId: "",
  ledgerByCustomer: {},
  ledgerFetchedAt: {},
  recentDeposits: [],
  depositsBusinessDate: todayIso(),
  loading: false,
  depositsLoading: false,
  posting: false,
  error: null,
  lastFetchedAt: null,
  liveSyncActive: false,
  walkInCustomerIdByBranch: {},

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
    const branchId = get().transactionBranchId || getRuntimeBranchId() || "";
    set({ loading: true, error: null });

    fetchInFlight = (async () => {
      try {
        const date = todayIso();
        const data = await getBranchCounterBootstrap(branchId, date, { minimal: true });
        const nextBranchId = resolveBranchId(get().transactionBranchId, data.branches);
        set({
          customers: data.customers,
          branches: data.branches,
          bankProducts: filterDepositProducts(data.bankProducts ?? []),
          transactionBranchId: nextBranchId,
          lastFetchedAt: Date.now(),
          error: null,
          loading: false
        });
        if (nextBranchId) {
          setRuntimeBranchId(nextBranchId);
        }
        set({ depositsLoading: true });
        void loadDepositsForBranch(nextBranchId, date)
          .then((depositsData) => {
            if (depositsData) {
              set({
                recentDeposits: depositsData.deposits,
                depositsBusinessDate: depositsData.businessDate
              });
            }
          })
          .finally(() => set({ depositsLoading: false }));
        const selected = get().selectedCustomerId;
        if (selected) {
          void get().loadLedger(selected, { force: true });
        }
      } catch (error) {
        set({ error: toUserFacingError(error, "Could not load agency teller data"), loading: false });
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
    const branchId = get().transactionBranchId || getRuntimeBranchId() || "";
    fetchInFlight = (async () => {
      try {
        const date = todayIso();
        const nextBranchId = resolveBranchId(get().transactionBranchId, get().branches);
        const effectiveBranch = branchId || nextBranchId;
        const [data, depositsData] = await Promise.all([
          getBranchCounterBootstrap(effectiveBranch, date, { minimal: true }),
          loadDepositsForBranch(effectiveBranch, date)
        ]);
        const resolvedBranchId = resolveBranchId(get().transactionBranchId, data.branches);
        set({
          customers: data.customers,
          branches: data.branches,
          bankProducts: filterDepositProducts(data.bankProducts ?? []),
          transactionBranchId: resolvedBranchId,
          recentDeposits: depositsData?.deposits ?? get().recentDeposits,
          depositsBusinessDate: depositsData?.businessDate ?? date,
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

  setTransactionBranchId: (branchId) => {
    set({ transactionBranchId: branchId });
    setRuntimeBranchId(branchId);
    void get().refresh();
  },

  selectCustomer: (customerId) => {
    set({ selectedCustomerId: customerId });
    if (customerId) {
      void get().loadLedger(customerId);
    }
  },

  loadLedger: async (customerId, options) => {
    const fetchedAt = get().ledgerFetchedAt[customerId];
    if (!options?.force && fetchedAt && Date.now() - fetchedAt < LEDGER_STALE_MS) {
      return;
    }
    try {
      const ledger = await getCustomerLedger(customerId);
      set((state) => ({
        ledgerByCustomer: { ...state.ledgerByCustomer, [customerId]: ledger },
        ledgerFetchedAt: { ...state.ledgerFetchedAt, [customerId]: Date.now() }
      }));
    } catch {
      /* non-blocking */
    }
  },

  refreshDeposits: async () => {
    const branchId = get().transactionBranchId || getRuntimeBranchId() || "";
    if (!branchId) {
      return;
    }
    set({ depositsLoading: true });
    try {
      const depositsData = await getTellerAgencyDeposits({ branchId, date: todayIso() });
      set({
        recentDeposits: depositsData.deposits,
        depositsBusinessDate: depositsData.businessDate
      });
    } catch {
      /* keep cache */
    } finally {
      set({ depositsLoading: false });
    }
  },

  updatePendingDeposit: async (transactionId, payload) => {
    const deposit = await updateTellerAgencyDeposit(transactionId, payload);
    set((state) => ({
      recentDeposits: state.recentDeposits.map((row) => (row.id === deposit.id ? deposit : row))
    }));
    return deposit;
  },

  cancelPendingDeposit: async (transactionId, reason) => {
    await cancelTellerAgencyDeposit(transactionId, reason);
    await get().refreshDeposits();
  },

  postDeposit: async (payload) => {
    set({ posting: true, error: null });
    try {
      let customerId = payload.customerId;
      if (!customerId) {
        const cached = get().walkInCustomerIdByBranch[payload.transactionBranchId];
        if (cached) {
          customerId = cached;
        } else {
          const walkIn = await getAgencyWalkInCustomer(payload.transactionBranchId);
          customerId = walkIn.id;
          set({
            walkInCustomerIdByBranch: {
              ...get().walkInCustomerIdByBranch,
              [payload.transactionBranchId]: customerId
            }
          });
        }
      }
      await createTransaction({
        customerId,
        type: "deposit",
        amount: payload.amount,
        transactionBranchId: payload.transactionBranchId,
        notes: payload.notes,
        bankProductId: payload.bankProductId,
        workflowData: payload.workflowData,
        manualPartnerAccount: payload.manualPartnerAccount
      });
      void get().refreshSilent();
      void get().loadLedger(customerId, { force: true });
      void get().refreshDeposits();
    } catch (error) {
      set({ error: toUserFacingError(error, "Deposit failed") });
      throw error;
    } finally {
      set({ posting: false });
    }
  },

  startLiveSync: () => {
    if (get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSyncMgr.start({
      getTenantId,
      tables: ["customer_transactions", "customers", "ledger_entries"],
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt)
    });
  },

  stopLiveSync: () => {
    if (!get().liveSyncActive) {
      return;
    }
    liveSyncMgr.stop();
    silentScheduler.clear();
    set({ liveSyncActive: false });
  }
}));

export function selectActiveAgencyCustomers(customers: Customer[]): Customer[] {
  return customers.filter((c) => c.status === "active");
}
