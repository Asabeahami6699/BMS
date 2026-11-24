import { create } from "zustand";
import type { TenantBankProduct } from "@bms/shared";
import type {
  BalanceDisclosure,
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
  getBranchCounterStatement,
  getCustomerLedger,
  getRuntimeBranchId,
  getTenantId,
  setRuntimeBranchId,
  paySusuFieldWithdrawal
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

const LEDGER_STALE_MS = 90_000;
/** Full customer/branch/product catalog refresh interval. */
const CATALOG_STALE_MS = 2 * 60_000;
const silentScheduler = createSilentRefreshScheduler();
const liveSyncMgr = createLiveSyncManager();

let catalogFetchedAt: number | null = null;

type PostPayload = {
  customerId: string;
  type: "daily_susu" | "deposit" | "withdrawal";
  amount: number;
  transactionBranchId: string;
  notes?: string;
  bankProductId?: string;
};

const TELLER_CALLOVER_STORAGE_PREFIX = "bms:teller-callover:";

type PersistedTellerCallover = {
  checkedIds: string[];
  confirmed: boolean;
};

function readTellerCallover(sessionId: string): PersistedTellerCallover | null {
  if (typeof window === "undefined" || !sessionId) {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(`${TELLER_CALLOVER_STORAGE_PREFIX}${sessionId}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedTellerCallover>;
    return {
      checkedIds: Array.isArray(parsed.checkedIds)
        ? parsed.checkedIds.filter((id): id is string => typeof id === "string")
        : [],
      confirmed: Boolean(parsed.confirmed)
    };
  } catch {
    return null;
  }
}

function writeTellerCallover(sessionId: string, value: PersistedTellerCallover): void {
  if (typeof window === "undefined" || !sessionId) {
    return;
  }
  try {
    window.sessionStorage.setItem(
      `${TELLER_CALLOVER_STORAGE_PREFIX}${sessionId}`,
      JSON.stringify(value)
    );
  } catch {
    /* ignore quota errors */
  }
}

function removeTellerCallover(sessionId: string): void {
  if (typeof window === "undefined" || !sessionId) {
    return;
  }
  try {
    window.sessionStorage.removeItem(`${TELLER_CALLOVER_STORAGE_PREFIX}${sessionId}`);
  } catch {
    /* ignore */
  }
}

async function resolveTellerTodayStatement(
  floatSession: BranchFloatSession | null,
  bootstrapStatement: BranchCounterStatement | null,
  fallbackCurrent: BranchCounterStatement | null
): Promise<BranchCounterStatement | null> {
  if (!floatSession || floatSession.status !== "open") {
    return bootstrapStatement;
  }
  if (
    bootstrapStatement &&
    bootstrapStatement.summary.branchId === floatSession.branchId &&
    bootstrapStatement.summary.date === floatSession.businessDate
  ) {
    return bootstrapStatement;
  }
  try {
    return await getBranchCounterStatement(floatSession.branchId, floatSession.businessDate);
  } catch {
    return fallbackCurrent ?? bootstrapStatement;
  }
}

type BranchCounterState = {
  customers: Customer[];
  branches: Branch[];
  bankProducts: TenantBankProduct[];
  statement: BranchCounterStatement | null;
  tellerTodayStatement: BranchCounterStatement | null;
  tellerCalloverCheckedBySession: Record<string, string[]>;
  tellerCalloverConfirmedBySession: Record<string, boolean>;
  floatSession: BranchFloatSession | null;
  priorOpenFloatSession: BranchFloatSession | null;
  floatSummary: BranchFloatSummary;
  pendingFloatRequests: BranchFloatSession[];
  pendingFieldPayouts: BalanceDisclosure[];
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
  payingPayoutId: string | null;
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
  payFieldPayout: (disclosureId: string) => Promise<void>;
  initBranchScope: (isHeadOfficeRole: boolean) => void;
  hydrateTellerCallover: (sessionId: string) => void;
  toggleTellerCalloverTx: (sessionId: string, txId: string) => void;
  setTellerCalloverMany: (sessionId: string, txIds: string[], checked: boolean) => void;
  setTellerCalloverConfirmed: (sessionId: string, confirmed: boolean) => void;
  clearTellerCallover: (sessionId: string) => void;
};

let fetchInFlight: Promise<void> | null = null;
let ledgerInFlight = new Map<string, Promise<void>>();
let postInFlight: { fingerprint: string; promise: Promise<Transaction> } | null = null;
let postRetry: { fingerprint: string; key: string } | null = null;

function postFingerprint(payload: PostPayload): string {
  return [
    payload.customerId,
    payload.type,
    String(payload.amount),
    payload.transactionBranchId,
    payload.notes ?? "",
    payload.bankProductId ?? ""
  ].join("|");
}

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
  if (branches.length === 1) {
    const only = branches[0].id;
    return {
      ...(statementBranchId === only ? {} : { statementBranchId: only }),
      transactionBranchId: only
    };
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
  tellerTodayStatement: null,
  tellerCalloverCheckedBySession: {},
  tellerCalloverConfirmedBySession: {},
  floatSession: null,
  priorOpenFloatSession: null,
  floatSummary: null,
  pendingFloatRequests: [],
  pendingFieldPayouts: [],
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
  payingPayoutId: null,
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
        const tellerTodayStatement = await resolveTellerTodayStatement(
          data.floatSession,
          data.statement,
          get().tellerTodayStatement
        );
        const now = Date.now();
        catalogFetchedAt = now;
        set({
          customers: data.customers,
          branches: data.branches,
          bankProducts: data.bankProducts ?? [],
          statement: data.statement,
          tellerTodayStatement,
          floatSession: data.floatSession,
          priorOpenFloatSession: data.priorOpenFloatSession ?? null,
          floatSummary: data.floatSummary,
          pendingFloatRequests: data.pendingFloatRequests,
          pendingFieldPayouts: data.pendingFieldPayouts ?? [],
          ...branchPatch,
          lastFetchedAt: now,
          sessionExpired: false,
          error: null
        });
        if (data.floatSession?.id) {
          get().hydrateTellerCallover(data.floatSession.id);
        }
        if (branchPatch.statementBranchId) {
          setRuntimeBranchId(branchPatch.statementBranchId, { silent: true });
        }
        if (
          selectedCustomerId &&
          !data.customers.some((c) => c.id === selectedCustomerId && c.status === "active")
        ) {
          set({ selectedCustomerId: "" });
        }
        if (selectedCustomerId) {
          await get().loadLedger(selectedCustomerId, { silent: true });
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

    const catalogStale =
      get().customers.length === 0 ||
      catalogFetchedAt == null ||
      Date.now() - catalogFetchedAt >= CATALOG_STALE_MS;

    fetchInFlight = (async () => {
      try {
        if (catalogStale) {
          const data = await getBranchCounterBootstrap(scopedBranchId, statementDate);
          const branchPatch = reconcileBranchScope(scopedBranchId, data.branches);
          const tellerTodayStatement = await resolveTellerTodayStatement(
            data.floatSession,
            data.statement,
            get().tellerTodayStatement
          );
          const now = Date.now();
          catalogFetchedAt = now;
          set({
            customers: data.customers,
            branches: data.branches,
            bankProducts: data.bankProducts ?? [],
            statement: data.statement,
            tellerTodayStatement,
            floatSession: data.floatSession,
            priorOpenFloatSession: data.priorOpenFloatSession ?? null,
            floatSummary: data.floatSummary,
            pendingFloatRequests: data.pendingFloatRequests,
            pendingFieldPayouts: data.pendingFieldPayouts ?? [],
            ...branchPatch,
            lastFetchedAt: now,
            sessionExpired: false,
            error: null
          });
          if (data.floatSession?.id) {
            get().hydrateTellerCallover(data.floatSession.id);
          }
          if (branchPatch.statementBranchId) {
            setRuntimeBranchId(branchPatch.statementBranchId, { silent: true });
          }
        } else {
          const data = await getBranchCounterBootstrap(scopedBranchId, statementDate, {
            hot: true
          });
          const tellerTodayStatement = await resolveTellerTodayStatement(
            data.floatSession,
            data.statement,
            get().tellerTodayStatement
          );
          set({
            statement: data.statement,
            tellerTodayStatement,
            floatSession: data.floatSession,
            priorOpenFloatSession: data.priorOpenFloatSession ?? null,
            floatSummary: data.floatSummary,
            pendingFloatRequests: data.pendingFloatRequests,
            pendingFieldPayouts: data.pendingFieldPayouts ?? [],
            lastFetchedAt: Date.now(),
            sessionExpired: false,
            error: null
          });
          if (data.floatSession?.id) {
            get().hydrateTellerCallover(data.floatSession.id);
          }
        }
        if (selectedCustomerId) {
          await get().loadLedger(selectedCustomerId, { silent: true });
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
      tables: [
        "customer_transactions",
        "ledger_entries",
        "customers",
        "branch_float_sessions",
        "branch_float_movements",
        "customer_balance_disclosures",
        "agent_notifications"
      ],
      // Float approvals must show on the till immediately — short debounce.
      debounceMs: 400,
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt, LEDGER_STALE_MS)
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
    const fingerprint = postFingerprint(payload);
    if (postInFlight?.fingerprint === fingerprint) {
      return postInFlight.promise;
    }
    const key = postRetry?.fingerprint === fingerprint ? postRetry.key : crypto.randomUUID();
    postRetry = { fingerprint, key };
    const flight: { fingerprint: string; promise: Promise<Transaction> } = {
      fingerprint,
      promise: Promise.resolve({} as Transaction)
    };
    flight.promise = (async () => {
      set({ posting: true });
      try {
        const transaction = await createTransaction(payload, key);
        postRetry = null;
        const customerId = payload.customerId;
        await get().loadLedger(customerId, { silent: true, force: true });
        void import("./susuCycleCommissionStore").then(({ useSusuCycleCommissionStore }) => {
          const passbookStore = useSusuCycleCommissionStore.getState();
          passbookStore.invalidateCustomerPassbook(customerId);
          void passbookStore.refreshCustomerPassbookSilent(customerId);
        });
        // Hot slice only — keep cached customer catalog.
        const statementDate = get().statementDate;
        const scopedBranchId = resolveStatementBranchId(get().statementBranchId);
        try {
          const data = await getBranchCounterBootstrap(scopedBranchId, statementDate, {
            hot: true
          });
          set({
            statement: data.statement,
            floatSession: data.floatSession,
            priorOpenFloatSession: data.priorOpenFloatSession ?? null,
            floatSummary: data.floatSummary,
            pendingFloatRequests: data.pendingFloatRequests,
            pendingFieldPayouts: data.pendingFieldPayouts ?? [],
            lastFetchedAt: Date.now()
          });
        } catch {
          /* ledger already refreshed */
        }
        return transaction;
      } finally {
        set({ posting: false });
        if (postInFlight === flight) {
          postInFlight = null;
        }
      }
    })();
    postInFlight = flight;
    return flight.promise;
  },

  payFieldPayout: async (disclosureId) => {
    set({ payingPayoutId: disclosureId, error: null });
    try {
      const pending = get().pendingFieldPayouts.find((row) => row.id === disclosureId);
      const customerId = pending?.customerId;
      await paySusuFieldWithdrawal(disclosureId);
      await get().refreshSilent();
      if (customerId) {
        await get().loadLedger(customerId, { silent: true, force: true });
      }
    } catch (error) {
      set({ error: toUserFacingError(error, "Pay now failed") });
      throw error;
    } finally {
      set({ payingPayoutId: null });
    }
  },

  hydrateTellerCallover: (sessionId) => {
    if (!sessionId) {
      return;
    }
    const existing = get().tellerCalloverCheckedBySession[sessionId];
    if (existing !== undefined) {
      return;
    }
    const persisted = readTellerCallover(sessionId);
    if (!persisted) {
      return;
    }
    set((state) => ({
      tellerCalloverCheckedBySession: {
        ...state.tellerCalloverCheckedBySession,
        [sessionId]: persisted.checkedIds
      },
      tellerCalloverConfirmedBySession: {
        ...state.tellerCalloverConfirmedBySession,
        [sessionId]: persisted.confirmed
      }
    }));
  },

  toggleTellerCalloverTx: (sessionId, txId) => {
    if (!sessionId || !txId) {
      return;
    }
    const current = get().tellerCalloverCheckedBySession[sessionId] ?? [];
    const next = current.includes(txId)
      ? current.filter((id) => id !== txId)
      : [...current, txId];
    const nextConfirmed = false;
    writeTellerCallover(sessionId, { checkedIds: next, confirmed: nextConfirmed });
    set((state) => ({
      tellerCalloverCheckedBySession: {
        ...state.tellerCalloverCheckedBySession,
        [sessionId]: next
      },
      tellerCalloverConfirmedBySession: {
        ...state.tellerCalloverConfirmedBySession,
        [sessionId]: nextConfirmed
      }
    }));
  },

  setTellerCalloverMany: (sessionId, txIds, checked) => {
    if (!sessionId) {
      return;
    }
    const current = new Set(get().tellerCalloverCheckedBySession[sessionId] ?? []);
    for (const id of txIds) {
      if (checked) {
        current.add(id);
      } else {
        current.delete(id);
      }
    }
    const next = [...current];
    const nextConfirmed = false;
    writeTellerCallover(sessionId, { checkedIds: next, confirmed: nextConfirmed });
    set((state) => ({
      tellerCalloverCheckedBySession: {
        ...state.tellerCalloverCheckedBySession,
        [sessionId]: next
      },
      tellerCalloverConfirmedBySession: {
        ...state.tellerCalloverConfirmedBySession,
        [sessionId]: nextConfirmed
      }
    }));
  },

  setTellerCalloverConfirmed: (sessionId, confirmed) => {
    if (!sessionId) {
      return;
    }
    const checkedIds = get().tellerCalloverCheckedBySession[sessionId] ?? [];
    writeTellerCallover(sessionId, { checkedIds, confirmed });
    set((state) => ({
      tellerCalloverConfirmedBySession: {
        ...state.tellerCalloverConfirmedBySession,
        [sessionId]: confirmed
      }
    }));
  },

  clearTellerCallover: (sessionId) => {
    if (!sessionId) {
      return;
    }
    removeTellerCallover(sessionId);
    set((state) => {
      const nextChecked = { ...state.tellerCalloverCheckedBySession };
      const nextConfirmed = { ...state.tellerCalloverConfirmedBySession };
      delete nextChecked[sessionId];
      delete nextConfirmed[sessionId];
      return {
        tellerCalloverCheckedBySession: nextChecked,
        tellerCalloverConfirmedBySession: nextConfirmed
      };
    });
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
