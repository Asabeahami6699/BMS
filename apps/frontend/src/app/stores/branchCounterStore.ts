import { create } from "zustand";
import type { TenantBankProduct } from "@bms/shared";
import type {
  Branch,
  BranchCounterStatement,
  BranchFloatSession,
  BranchFloatSummary,
  Customer,
  LedgerEntry,
  Transaction
} from "../api";
import {
  ALL_BRANCHES_SCOPE,
  createTransaction,
  getBranchCounterBootstrap,
  getCustomerLedger,
  getRuntimeBranchId,
  getTenantId,
  setRuntimeBranchId
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

type PostPayload = {
  customerId: string;
  type: "daily_susu" | "deposit" | "withdrawal";
  amount: number;
  transactionBranchId: string;
  notes?: string;
  bankProductId?: string;
};

type BranchCounterState = {
  customers: Customer[];
  branches: Branch[];
  bankProducts: TenantBankProduct[];
  statement: BranchCounterStatement | null;
  floatSession: BranchFloatSession | null;
  floatSummary: BranchFloatSummary;
  pendingFloatRequests: BranchFloatSession[];
  statementBranchId: string;
  statementDate: string;
  transactionBranchId: string;
  selectedCustomerId: string;
  ledgerByCustomer: Record<string, LedgerEntry[]>;
  ledgerFetchedAt: Record<string, number>;
  loading: boolean;
  refreshing: boolean;
  statementLoading: boolean;
  ledgerLoading: boolean;
  posting: boolean;
  error: string | null;
  sessionExpired: boolean;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;

  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;

  setStatementBranchId: (branchId: string) => void;
  setStatementDate: (date: string) => void;
  setTransactionBranchId: (branchId: string) => void;
  selectCustomer: (customerId: string) => void;
  loadLedger: (customerId: string, options?: { silent?: boolean; force?: boolean }) => Promise<void>;
  postTransaction: (payload: PostPayload) => Promise<Transaction>;
  initBranchScope: (isHeadOfficeRole: boolean) => void;
};

let fetchInFlight: Promise<void> | null = null;
let ledgerInFlight = new Map<string, Promise<void>>();

function isUnauthorized(error: unknown): boolean {
  return (
    error instanceof Error &&
    (/\b401\b|unauthorized|session expired/i.test(error.message))
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveStatementBranchId(current: string): string {
  const runtimeScope = getRuntimeBranchId();
  if (runtimeScope && runtimeScope !== ALL_BRANCHES_SCOPE) {
    return runtimeScope;
  }
  if (current && current !== ALL_BRANCHES_SCOPE) {
    return current;
  }
  return "";
}

function reconcileBranchScope(
  statementBranchId: string,
  branches: Branch[]
): { statementBranchId?: string; transactionBranchId?: string } {
  if (branches.length === 0) {
    return {};
  }
  if (branches.some((b) => b.id === statementBranchId)) {
    return {};
  }
  const fallback = branches[0].id;
  return { statementBranchId: fallback, transactionBranchId: fallback };
}

export const useBranchCounterStore = create<BranchCounterState>((set, get) => ({
  customers: [],
  branches: [],
  bankProducts: [],
  statement: null,
  floatSession: null,
  floatSummary: null,
  pendingFloatRequests: [],
  statementBranchId: getRuntimeBranchId(),
  statementDate: todayIso(),
  transactionBranchId: getRuntimeBranchId(),
  selectedCustomerId: "",
  ledgerByCustomer: {},
  ledgerFetchedAt: {},
  loading: false,
  refreshing: false,
  statementLoading: false,
  ledgerLoading: false,
  posting: false,
  error: null,
  sessionExpired: false,
  lastFetchedAt: null,
  liveSyncActive: false,

  initBranchScope: (isHeadOfficeRole) => {
    if (!isHeadOfficeRole) {
      const branch = getRuntimeBranchId();
      set({
        statementBranchId: branch,
        transactionBranchId: branch
      });
    }
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
      if (get().customers.length === 0) {
        set({ loading: true });
      } else {
        set({ refreshing: true, statementLoading: true });
      }
      await fetchInFlight;
      set({ loading: false, refreshing: false, statementLoading: false });
      return;
    }

    const showFullLoader = get().customers.length === 0;
    set({
      loading: showFullLoader,
      refreshing: !showFullLoader,
      statementLoading: true,
      error: null
    });

    const statementDate = get().statementDate;
    const selectedCustomerId = get().selectedCustomerId;
    const scopedBranchId = resolveStatementBranchId(get().statementBranchId);
    if (scopedBranchId !== get().statementBranchId || scopedBranchId !== get().transactionBranchId) {
      set({ statementBranchId: scopedBranchId, transactionBranchId: scopedBranchId });
    }

    fetchInFlight = (async () => {
      try {
        const data = await getBranchCounterBootstrap(scopedBranchId, statementDate);
        const branchPatch = reconcileBranchScope(scopedBranchId, data.branches);
        set({
          customers: data.customers,
          branches: data.branches,
          bankProducts: data.bankProducts ?? [],
          statement: data.statement,
          floatSession: data.floatSession,
          floatSummary: data.floatSummary,
          pendingFloatRequests: data.pendingFloatRequests,
          ...branchPatch,
          lastFetchedAt: Date.now(),
          sessionExpired: false,
          error: null
        });
        if (branchPatch.statementBranchId) {
          setRuntimeBranchId(branchPatch.statementBranchId);
        }
        if (
          selectedCustomerId &&
          !data.customers.some((c) => c.id === selectedCustomerId && c.status === "active")
        ) {
          set({ selectedCustomerId: "" });
        }
        if (selectedCustomerId) {
          await get().loadLedger(selectedCustomerId, { silent: true, force: true });
        }
      } catch (error) {
        if (isUnauthorized(error)) {
          set({
            sessionExpired: true,
            error: "Your session expired. Sign in again to use the branch counter."
          });
        } else {
          set({ error: toUserFacingError(error, "Could not load branch counter data") });
        }
      } finally {
        set({ loading: false, refreshing: false, statementLoading: false });
        fetchInFlight = null;
      }
    })();
    await fetchInFlight;
  },

  refreshSilent: async () => {
    if (fetchInFlight) {
      return fetchInFlight;
    }
    const statementDate = get().statementDate;
    const selectedCustomerId = get().selectedCustomerId;
    const scopedBranchId = resolveStatementBranchId(get().statementBranchId);
    if (scopedBranchId !== get().statementBranchId || scopedBranchId !== get().transactionBranchId) {
      set({ statementBranchId: scopedBranchId, transactionBranchId: scopedBranchId });
    }
    set({ refreshing: true });

    fetchInFlight = (async () => {
      try {
        const data = await getBranchCounterBootstrap(scopedBranchId, statementDate);
        const branchPatch = reconcileBranchScope(scopedBranchId, data.branches);
        set({
          customers: data.customers,
          branches: data.branches,
          bankProducts: data.bankProducts ?? [],
          statement: data.statement,
          floatSession: data.floatSession,
          floatSummary: data.floatSummary,
          pendingFloatRequests: data.pendingFloatRequests,
          ...branchPatch,
          lastFetchedAt: Date.now(),
          sessionExpired: false,
          error: null
        });
        if (branchPatch.statementBranchId) {
          setRuntimeBranchId(branchPatch.statementBranchId);
        }
        if (selectedCustomerId) {
          await get().loadLedger(selectedCustomerId, { silent: true, force: true });
        }
      } catch {
        /* keep cache */
      } finally {
        set({ refreshing: false });
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  startLiveSync: () => {
    set({ liveSyncActive: true });
    liveSyncMgr.start({
      getTenantId,
      tables: ["customer_transactions", "ledger_entries", "customers"],
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt)
    });
  },

  stopLiveSync: () => {
    liveSyncMgr.stop();
    silentScheduler.clear();
    set({ liveSyncActive: false });
  },

  setStatementBranchId: (branchId) => {
    set({ statementBranchId: branchId, transactionBranchId: branchId, statementLoading: true });
    void get().refreshSilent().finally(() => set({ statementLoading: false }));
  },

  setStatementDate: (date) => {
    set({ statementDate: date, statementLoading: true });
    void get().refreshSilent().finally(() => set({ statementLoading: false }));
  },

  setTransactionBranchId: (branchId) => {
    set({ transactionBranchId: branchId, statementBranchId: branchId });
  },

  selectCustomer: (customerId) => {
    set({ selectedCustomerId: customerId });
    if (customerId) {
      void get().loadLedger(customerId);
    }
  },

  loadLedger: async (customerId, options) => {
    if (!customerId) {
      return;
    }
    const silent = options?.silent ?? false;
    const force = options?.force ?? false;
    const fetchedAt = get().ledgerFetchedAt[customerId];
    const cached = get().ledgerByCustomer[customerId];
    if (!force && cached && fetchedAt && Date.now() - fetchedAt < LEDGER_STALE_MS) {
      return;
    }

    let inflight = ledgerInFlight.get(customerId);
    if (!inflight) {
      if (!silent) {
        set({ ledgerLoading: true });
      }
      inflight = (async () => {
        try {
          const data = await getCustomerLedger(customerId);
          set((state) => ({
            ledgerByCustomer: { ...state.ledgerByCustomer, [customerId]: data },
            ledgerFetchedAt: { ...state.ledgerFetchedAt, [customerId]: Date.now() },
            sessionExpired: false
          }));
        } catch (error) {
          if (isUnauthorized(error)) {
            set({
              sessionExpired: true,
              error: "Your session expired. Sign in again to use the branch counter."
            });
          }
          set((state) => ({
            ledgerByCustomer: { ...state.ledgerByCustomer, [customerId]: [] }
          }));
          throw error;
        } finally {
          if (!silent) {
            set({ ledgerLoading: false });
          }
          ledgerInFlight.delete(customerId);
        }
      })();
      ledgerInFlight.set(customerId, inflight);
    }
    await inflight;
  },

  postTransaction: async (payload) => {
    set({ posting: true });
    try {
      const transaction = await createTransaction(payload);
      const customerId = payload.customerId;
      await Promise.all([
        get().loadLedger(customerId, { silent: true, force: true }),
        get().refreshSilent()
      ]);
      return transaction;
    } finally {
      set({ posting: false });
    }
  }
}));

export function selectActiveCustomers(customers: Customer[]): Customer[] {
  return customers.filter((c) => c.status === "active");
}

export function selectLedgerForCustomer(
  state: BranchCounterState,
  customerId: string
): LedgerEntry[] {
  return customerId ? (state.ledgerByCustomer[customerId] ?? []) : [];
}
