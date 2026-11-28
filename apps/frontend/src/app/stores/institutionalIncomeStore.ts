import { create } from "zustand";
import type {
  IncomeReportPeriod,
  InstitutionalIncomeReport,
  TransferInstitutionalIncomeToCapitalInput
} from "@bms/shared";
import {
  getActiveBranchFilter,
  getInstitutionalIncomeReport,
  getTenantId,
  reverseInstitutionalIncomeCapitalTransfer,
  transferInstitutionalIncomeToCapital,
  type ReverseIncomeCapitalTransferResponse,
  type TransferIncomeToCapitalResponse
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";
import { useSusuClosingBalancesStore } from "./susuClosingBalancesStore";

type IncomeState = {
  branchId: string | null;
  period: IncomeReportPeriod;
  report: InstitutionalIncomeReport | null;
  loading: boolean;
  transferring: boolean;
  reversingTransferId: string | null;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;

  setBranchId: (branchId: string | null) => void;
  setPeriod: (period: IncomeReportPeriod) => void;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  transferToCapital: (
    input: TransferInstitutionalIncomeToCapitalInput
  ) => Promise<TransferIncomeToCapitalResponse>;
  reverseTransfer: (
    transferId: string,
    reason: string
  ) => Promise<ReverseIncomeCapitalTransferResponse>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

export const useInstitutionalIncomeStore = create<IncomeState>((set, get) => ({
  branchId: getActiveBranchFilter() ?? null,
  period: "daily",
  report: null,
  loading: false,
  transferring: false,
  reversingTransferId: null,
  error: null,
  lastFetchedAt: null,
  liveSyncActive: false,

  setBranchId: (branchId) => {
    set({ branchId, lastFetchedAt: null });
    void get().refresh();
  },

  setPeriod: (period) => {
    set({ period, lastFetchedAt: null });
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
    const { branchId, period } = get();
    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        const report = await getInstitutionalIncomeReport({
          period,
          branchId: branchId ?? undefined
        });
        const nextPeriod = report.allowedPeriods.includes(period)
          ? period
          : (report.allowedPeriods[0] ?? "daily");
        set({
          report,
          period: nextPeriod,
          loading: false,
          lastFetchedAt: Date.now(),
          error: null
        });
        if (nextPeriod !== period) {
          // Re-fetch if permission forced a different period.
          const corrected = await getInstitutionalIncomeReport({
            period: nextPeriod,
            branchId: branchId ?? undefined
          });
          set({ report: corrected, lastFetchedAt: Date.now() });
        }
      } catch (error) {
        set({
          loading: false,
          error: toUserFacingError(error, "Could not load institutional income")
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
    const { branchId, period } = get();
    fetchInFlight = (async () => {
      try {
        const report = await getInstitutionalIncomeReport({
          period,
          branchId: branchId ?? undefined
        });
        set({ report, lastFetchedAt: Date.now(), error: null });
      } catch {
        // keep last good payload
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  transferToCapital: async (input) => {
    set({ transferring: true, error: null });
    try {
      const result = await transferInstitutionalIncomeToCapital(input);
      set({ transferring: false });
      await get().refreshSilent();
      if (useSusuClosingBalancesStore.getState().lastFetchedAt) {
        void useSusuClosingBalancesStore.getState().refreshSilent();
      }
      return result;
    } catch (error) {
      const message = toUserFacingError(error, "Could not transfer commission income to Business Capital");
      set({ transferring: false, error: message });
      throw new Error(message);
    }
  },

  reverseTransfer: async (transferId, reason) => {
    set({ reversingTransferId: transferId, error: null });
    try {
      const result = await reverseInstitutionalIncomeCapitalTransfer(transferId, { reason });
      set({ reversingTransferId: null });
      await get().refreshSilent();
      if (useSusuClosingBalancesStore.getState().lastFetchedAt) {
        void useSusuClosingBalancesStore.getState().refreshSilent();
      }
      return result;
    } catch (error) {
      const message = toUserFacingError(error, "Could not reverse commission capital transfer");
      set({ reversingTransferId: null, error: message });
      throw new Error(message);
    }
  },

  startLiveSync: () => {
    if (get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: [
        "branch_income_accounts",
        "institutional_income_entries",
        "institutional_income_capital_transfers"
      ],
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
