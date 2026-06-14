import { create } from "zustand";
import type {
  InvestmentFormConfig,
  InvestmentProduct,
  InvestmentRecord,
  InvestmentStatus,
  InvestmentSummary
} from "@bms/shared";
import { getInvestmentReports, getInvestmentsBootstrap, getTenantId, processInvestmentMaturities, type InvestmentsBootstrap } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type InvestmentState = {
  products: InvestmentProduct[];
  investments: InvestmentRecord[];
  formConfig: InvestmentFormConfig | null;
  summary: InvestmentSummary | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;
  portfolioSearch: string;
  portfolioStatus: InvestmentStatus | "";
  portfolioProductId: string;
  reportsLoading: boolean;
  reportsError: string | null;
  reportsLastFetchedAt: number | null;
  reportActive: InvestmentRecord[];
  reportMatured: InvestmentRecord[];
  reportRedeemed: InvestmentRecord[];
  reportAutoRenewed: InvestmentRecord[];
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  loadReports: (options?: { force?: boolean }) => Promise<void>;
  processMaturities: () => Promise<number>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
  setPortfolioSearch: (value: string) => void;
  setPortfolioStatus: (value: InvestmentStatus | "") => void;
  setPortfolioProductId: (value: string) => void;
  upsertInvestment: (row: InvestmentRecord) => void;
  prependInvestment: (row: InvestmentRecord) => void;
  upsertProduct: (row: InvestmentProduct) => void;
  setFormConfig: (config: InvestmentFormConfig) => void;
};

let fetchInFlight: Promise<void> | null = null;
let reportsFetchInFlight: Promise<void> | null = null;
let lastReportsKey = "";
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

function bootstrapSnapshotKey(data: InvestmentsBootstrap): string {
  const productSig = data.products.map((p) => `${p.id}:${p.status}:${p.name}`).join("|");
  const invSig = data.investments
    .map((i) => `${i.id}:${i.status}:${i.principalAmount}:${i.investmentNumber}`)
    .join("|");
  const formSig = `${data.formConfig.sections.length}:${data.formConfig.fields.length}`;
  const summarySig = data.summary
    ? `${data.summary.active}:${data.summary.matured}:${data.summary.totalPrincipal}`
    : "";
  return `${productSig}::${invSig}::${formSig}::${summarySig}`;
}

function applyBootstrap(data: InvestmentsBootstrap): Partial<InvestmentState> | null {
  const key = bootstrapSnapshotKey(data);
  if (key === lastSnapshotKey) {
    return null;
  }
  lastSnapshotKey = key;
  return {
    products: data.products,
    investments: data.investments,
    formConfig: data.formConfig,
    summary: data.summary,
    lastFetchedAt: Date.now(),
    error: null
  };
}

export const useInvestmentStore = create<InvestmentState>((set, get) => ({
  products: [],
  investments: [],
  formConfig: null,
  summary: null,
  loading: false,
  error: null,
  lastFetchedAt: null,
  liveSyncActive: false,
  portfolioSearch: "",
  portfolioStatus: "",
  portfolioProductId: "",
  reportsLoading: false,
  reportsError: null,
  reportsLastFetchedAt: null,
  reportActive: [],
  reportMatured: [],
  reportRedeemed: [],
  reportAutoRenewed: [],

  hydrate: (options) => {
    runHydrate({
      force: options?.force,
      loading: get().loading,
      lastFetchedAt: get().lastFetchedAt,
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
        const data = await getInvestmentsBootstrap();
        const patch = applyBootstrap(data);
        if (patch) {
          set(patch);
        }
      } catch (error) {
        set({ error: toUserFacingError(error, "Failed to load investments") });
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
        const data = await getInvestmentsBootstrap();
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

  loadReports: async (options) => {
    if (reportsFetchInFlight) {
      return reportsFetchInFlight;
    }
    if (!options?.force && isFresh(get().reportsLastFetchedAt) && get().summary != null) {
      return;
    }
    set({ reportsLoading: true, reportsError: null });
    reportsFetchInFlight = (async () => {
      try {
        const data = await getInvestmentReports();
        const key = `${data.summary.active}:${data.active.length}:${data.matured.length}:${data.redeemed.length}:${data.autoRenewed.length}`;
        if (key !== lastReportsKey) {
          lastReportsKey = key;
          set({
            summary: data.summary,
            reportActive: data.active,
            reportMatured: data.matured,
            reportRedeemed: data.redeemed,
            reportAutoRenewed: data.autoRenewed,
            reportsLastFetchedAt: Date.now(),
            reportsError: null,
            reportsLoading: false
          });
        } else {
          set({
            reportsLastFetchedAt: Date.now(),
            reportsError: null,
            reportsLoading: false
          });
        }
      } catch (error) {
        set({
          reportsError: toUserFacingError(error, "Failed to load investment reports"),
          reportsLoading: false
        });
      } finally {
        reportsFetchInFlight = null;
      }
    })();
    await reportsFetchInFlight;
  },

  processMaturities: async () => {
    const renewed = await processInvestmentMaturities();
    lastReportsKey = "";
    await get().loadReports({ force: true });
    await get().refreshSilent();
    return renewed.length;
  },

  setPortfolioSearch: (value) => set({ portfolioSearch: value }),
  setPortfolioStatus: (value) => set({ portfolioStatus: value }),
  setPortfolioProductId: (value) => set({ portfolioProductId: value }),

  startLiveSync: () => {
    if (!get().liveSyncActive) {
      set({ liveSyncActive: true });
    }
    liveSync.start({
      getTenantId,
      tables: [
        "investment_products",
        "investment_form_configs",
        "investments",
        "investment_beneficiaries",
        "investment_attachments",
        "investment_audit_log"
      ],
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt),
      pollMs: 0
    });
  },

  stopLiveSync: () => {
    liveSync.stop();
    silentScheduler.clear();
    if (get().liveSyncActive) {
      set({ liveSyncActive: false });
    }
  },

  upsertInvestment: (row) => {
    lastSnapshotKey = "";
    set((state) => {
      const investments = state.investments.some((i) => i.id === row.id)
        ? state.investments.map((i) => (i.id === row.id ? row : i))
        : [row, ...state.investments];
      return { investments };
    });
  },

  prependInvestment: (row) => {
    lastSnapshotKey = "";
    set((state) => ({
      investments: [row, ...state.investments.filter((i) => i.id !== row.id)]
    }));
  },

  upsertProduct: (row) => {
    lastSnapshotKey = "";
    set((state) => ({
      products: state.products.some((p) => p.id === row.id)
        ? state.products.map((p) => (p.id === row.id ? row : p))
        : [row, ...state.products]
    }));
  },

  setFormConfig: (config) => {
    lastSnapshotKey = "";
    set({ formConfig: config });
  }
}));

export function selectInvestmentKpis(state: { summary: InvestmentSummary | null }) {
  const summary = state.summary;
  if (!summary) {
    return {
      active: 0,
      matured: 0,
      redeemed: 0,
      autoRenewed: 0,
      totalPrincipal: 0,
      totalExpectedInterest: 0
    };
  }
  return {
    active: summary.active,
    matured: summary.matured,
    redeemed: summary.redeemed,
    autoRenewed: summary.autoRenewed,
    totalPrincipal: summary.totalPrincipal,
    totalExpectedInterest: summary.totalExpectedInterest
  };
}

const STATUS_LABELS: Record<InvestmentStatus, string> = {
  active: "Active",
  matured: "Matured",
  redeemed: "Redeemed",
  closed: "Closed",
  cancelled: "Cancelled"
};

export function selectFilteredPortfolio(state: {
  investments: InvestmentRecord[];
  portfolioSearch: string;
  portfolioStatus: InvestmentStatus | "";
  portfolioProductId: string;
}): InvestmentRecord[] {
  const needle = state.portfolioSearch.trim().toLowerCase();
  return state.investments.filter((row) => {
    if (state.portfolioStatus && row.status !== state.portfolioStatus) {
      return false;
    }
    if (state.portfolioProductId && row.productId !== state.portfolioProductId) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return (
      row.customerName.toLowerCase().includes(needle) ||
      (row.customerPhone ?? "").includes(needle) ||
      row.investmentNumber.toLowerCase().includes(needle) ||
      row.productName.toLowerCase().includes(needle)
    );
  });
}

export { STATUS_LABELS as INVESTMENT_STATUS_LABELS };
