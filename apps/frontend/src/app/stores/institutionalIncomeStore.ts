import { create } from "zustand";
import type { IncomeReportPeriod, InstitutionalIncomeReport } from "@bms/shared";
import { getActiveBranchFilter, getInstitutionalIncomeReport, getTenantId } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type IncomeState = {
  branchId: string | null;
  period: IncomeReportPeriod;
  report: InstitutionalIncomeReport | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;

  setBranchId: (branchId: string | null) => void;
  setPeriod: (period: IncomeReportPeriod) => void;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
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

  startLiveSync: () => {
    if (get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: ["branch_income_accounts", "institutional_income_entries"],
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
