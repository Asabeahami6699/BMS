import { create } from "zustand";
import type { LoanApplication, LoanGroup, LoanProduct } from "@bms/shared";
import {
  getLoanDetail,
  getLoansBootstrap,
  getTenantId,
  type LoanDetail,
  type LoansBootstrap
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

export type LoansSummary = LoansBootstrap["summary"];

type LoansState = {
  products: LoanProduct[];
  applications: LoanApplication[];
  groups: LoanGroup[];
  summary: LoansSummary | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
  patchApplication: (row: LoanApplication) => void;
  prependApplication: (row: LoanApplication) => void;
  upsertProduct: (row: LoanProduct) => void;
  upsertGroup: (row: LoanGroup) => void;
  setGroups: (rows: LoanGroup[]) => void;
  detailByLoanId: Record<string, LoanDetail>;
  detailFetchedAtByLoanId: Record<string, number>;
  detailLoadingByLoanId: Record<string, boolean>;
  detailErrorByLoanId: Record<string, string | null>;
  detailLiveSyncActive: boolean;
  ensureLoanDetail: (loanId: string, options?: { force?: boolean }) => Promise<void>;
  refreshLoanDetailSilent: (loanId: string) => Promise<void>;
  setLoanDetail: (loanId: string, detail: LoanDetail) => void;
  startDetailLiveSync: (loanId: string) => void;
  stopDetailLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();
const detailSilentScheduler = createSilentRefreshScheduler();
const detailLiveSync = createLiveSyncManager();
const detailInFlight = new Map<string, Promise<void>>();
let watchedLoanId: string | null = null;

function bootstrapSnapshotKey(data: LoansBootstrap): string {
  const productSig = data.products
    .map((p) => `${p.id}:${p.status}:${p.name}:${p.minAmount}:${p.maxAmount}`)
    .join("|");
  const appSig = data.applications
    .map(
      (a) =>
        `${a.id}:${a.status}:${a.outstandingPrincipal}:${a.totalRepaid}:${a.installmentsPaid ?? 0}:${a.nextDueDate ?? ""}`
    )
    .join("|");
  const groupSig = data.groups
    .map((g) => `${g.id}:${g.status}:${g.name}:${g.activeMemberCount ?? 0}`)
    .join("|");
  const summarySig = data.summary
    ? `${data.summary.pendingApproval}:${data.summary.approved}:${data.summary.disbursed}:${data.summary.totalOutstanding}:${data.summary.overdueInstallments}`
    : "";
  return `${productSig}::${appSig}::${groupSig}::${summarySig}`;
}

function applyBootstrap(data: LoansBootstrap): Partial<LoansState> | null {
  const key = bootstrapSnapshotKey(data);
  if (key === lastSnapshotKey) {
    return null;
  }
  lastSnapshotKey = key;
  return {
    products: data.products,
    applications: data.applications,
    groups: data.groups ?? [],
    summary: data.summary,
    lastFetchedAt: Date.now(),
    error: null
  };
}

function recomputeSummary(applications: LoanApplication[]): LoansSummary {
  const disbursedLoans = applications.filter((a) => a.status === "disbursed");
  return {
    pendingApproval: applications.filter((a) => a.status === "pending_approval").length,
    approved: applications.filter((a) => a.status === "approved").length,
    disbursed: disbursedLoans.length,
    closed: applications.filter((a) => a.status === "closed").length,
    totalOutstanding: disbursedLoans.reduce((sum, a) => sum + a.outstandingPrincipal, 0),
    totalRepaid: applications.reduce((sum, a) => sum + a.totalRepaid, 0),
    overdueInstallments: 0
  };
}

export const useLoansStore = create<LoansState>((set, get) => ({
  products: [],
  applications: [],
  groups: [],
  summary: null,
  loading: false,
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
      if (!get().loading) {
        set({ loading: true });
      }
      await fetchInFlight;
      if (get().loading) {
        set({ loading: false });
      }
      return;
    }

    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        const data = await getLoansBootstrap();
        const patch = applyBootstrap(data);
        if (patch) {
          set(patch);
        }
      } catch (error) {
        set({ error: toUserFacingError(error, "Failed to load loans") });
      } finally {
        set({ loading: false });
        fetchInFlight = null;
      }
    })();
    await fetchInFlight;
  },

  refreshSilent: async () => {
    if (fetchInFlight) {
      return fetchInFlight;
    }
    fetchInFlight = (async () => {
      try {
        const data = await getLoansBootstrap();
        const patch = applyBootstrap(data);
        if (patch) {
          set(patch);
        }
      } catch {
        /* keep cache */
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  startLiveSync: () => {
    if (!get().liveSyncActive) {
      set({ liveSyncActive: true });
    }
    liveSync.start({
      getTenantId,
      tables: ["loan_products", "loan_applications", "loan_repayments", "loan_repayment_schedule", "loan_groups", "loan_group_members"],
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt)
    });
  },

  stopLiveSync: () => {
    liveSync.stop();
    silentScheduler.clear();
    if (get().liveSyncActive) {
      set({ liveSyncActive: false });
    }
  },

  patchApplication: (row) => {
    lastSnapshotKey = "";
    set((state) => {
      const applications = state.applications.map((a) => (a.id === row.id ? row : a));
      return {
        applications,
        summary: recomputeSummary(applications)
      };
    });
  },

  prependApplication: (row) => {
    lastSnapshotKey = "";
    set((state) => {
      const applications = [row, ...state.applications.filter((a) => a.id !== row.id)];
      return {
        applications,
        summary: recomputeSummary(applications)
      };
    });
  },

  upsertProduct: (row) => {
    lastSnapshotKey = "";
    set((state) => ({
      products: state.products.some((p) => p.id === row.id)
        ? state.products.map((p) => (p.id === row.id ? row : p))
        : [row, ...state.products]
    }));
  },

  upsertGroup: (row) => {
    lastSnapshotKey = "";
    set((state) => ({
      groups: state.groups.some((g) => g.id === row.id)
        ? state.groups.map((g) => (g.id === row.id ? row : g))
        : [row, ...state.groups]
    }));
  },

  setGroups: (rows) => {
    lastSnapshotKey = "";
    set({ groups: rows });
  },

  detailByLoanId: {},
  detailFetchedAtByLoanId: {},
  detailLoadingByLoanId: {},
  detailErrorByLoanId: {},
  detailLiveSyncActive: false,

  ensureLoanDetail: async (loanId, options) => {
    if (!loanId) {
      return;
    }
    watchedLoanId = loanId;
    const force = options?.force ?? false;
    const fetchedAt = get().detailFetchedAtByLoanId[loanId];
    const cached = get().detailByLoanId[loanId];
    if (!force && cached && isFresh(fetchedAt ?? null)) {
      return;
    }

    const existing = detailInFlight.get(loanId);
    if (existing) {
      return existing;
    }

    const showLoader = !cached;
    if (showLoader) {
      set((state) => ({
        detailLoadingByLoanId: { ...state.detailLoadingByLoanId, [loanId]: true },
        detailErrorByLoanId: { ...state.detailErrorByLoanId, [loanId]: null }
      }));
    }

    const flight = (async () => {
      try {
        const detail = await getLoanDetail(loanId);
        set((state) => ({
          detailByLoanId: { ...state.detailByLoanId, [loanId]: detail },
          detailFetchedAtByLoanId: { ...state.detailFetchedAtByLoanId, [loanId]: Date.now() },
          detailErrorByLoanId: { ...state.detailErrorByLoanId, [loanId]: null }
        }));
      } catch (error) {
        set((state) => ({
          detailErrorByLoanId: {
            ...state.detailErrorByLoanId,
            [loanId]: toUserFacingError(error, "Failed to load loan")
          }
        }));
      } finally {
        set((state) => ({
          detailLoadingByLoanId: { ...state.detailLoadingByLoanId, [loanId]: false }
        }));
        detailInFlight.delete(loanId);
      }
    })();

    detailInFlight.set(loanId, flight);
    return flight;
  },

  refreshLoanDetailSilent: async (loanId) => {
    if (!loanId) {
      return;
    }
    const existing = detailInFlight.get(loanId);
    if (existing) {
      return existing;
    }
    const flight = (async () => {
      try {
        const detail = await getLoanDetail(loanId);
        set((state) => ({
          detailByLoanId: { ...state.detailByLoanId, [loanId]: detail },
          detailFetchedAtByLoanId: { ...state.detailFetchedAtByLoanId, [loanId]: Date.now() },
          detailErrorByLoanId: { ...state.detailErrorByLoanId, [loanId]: null }
        }));
      } catch {
        /* keep cache */
      } finally {
        detailInFlight.delete(loanId);
      }
    })();
    detailInFlight.set(loanId, flight);
    return flight;
  },

  setLoanDetail: (loanId, detail) => {
    set((state) => ({
      detailByLoanId: { ...state.detailByLoanId, [loanId]: detail },
      detailFetchedAtByLoanId: { ...state.detailFetchedAtByLoanId, [loanId]: Date.now() }
    }));
  },

  startDetailLiveSync: (loanId) => {
    if (!loanId) {
      return;
    }
    watchedLoanId = loanId;
    if (!get().detailLiveSyncActive) {
      set({ detailLiveSyncActive: true });
    }
    detailLiveSync.start({
      getTenantId,
      tables: [
        "loan_applications",
        "loan_repayments",
        "loan_repayment_schedule",
        "customers"
      ],
      onRefresh: () => {
        const id = watchedLoanId;
        if (!id) {
          return;
        }
        detailSilentScheduler.schedule(() => void get().refreshLoanDetailSilent(id));
      },
      isStale: () => {
        const id = watchedLoanId;
        if (!id) {
          return false;
        }
        return !isFresh(get().detailFetchedAtByLoanId[id] ?? null);
      }
    });
  },

  stopDetailLiveSync: () => {
    detailLiveSync.stop();
    detailSilentScheduler.clear();
    watchedLoanId = null;
    if (get().detailLiveSyncActive) {
      set({ detailLiveSyncActive: false });
    }
  }
}));

export function selectLoanDetail(
  state: Pick<LoansState, "detailByLoanId">,
  loanId: string | undefined
): LoanDetail | null {
  if (!loanId) {
    return null;
  }
  return state.detailByLoanId[loanId] ?? null;
}

export function selectLoansKpis(state: { summary: LoansSummary | null }) {
  const summary = state.summary;
  if (!summary) {
    return {
      pendingApproval: 0,
      approved: 0,
      disbursed: 0,
      overdueInstallments: 0,
      totalOutstanding: 0,
      totalRepaid: 0
    };
  }
  return {
    pendingApproval: summary.pendingApproval,
    approved: summary.approved,
    disbursed: summary.disbursed,
    overdueInstallments: summary.overdueInstallments,
    totalOutstanding: summary.totalOutstanding,
    totalRepaid: summary.totalRepaid
  };
}
