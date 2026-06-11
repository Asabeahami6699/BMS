import { create } from "zustand";
import type { AuditorDashboard } from "@bms/shared";
import type { AuditLogRecord } from "../api";
import {
  getAuditorDashboard,
  getBackOfficeBootstrap,
  getTenantId,
  listAuditLogs
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

const DESK_STALE_MS = 30_000;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

type State = {
  branchId: string;
  dashboard: AuditorDashboard | null;
  auditLogs: AuditLogRecord[];
  pendingAccountant: number;
  pendingBank: number;
  dashboardLoading: boolean;
  exceptionsLoading: boolean;
  error: string | null;
  exceptionsError: string | null;
  lastDashboardAt: number | null;
  lastExceptionsAt: number | null;
  liveSyncActive: boolean;

  hydrateDashboard: (options?: { force?: boolean; branchId?: string }) => void;
  refreshDashboard: () => Promise<void>;
  refreshDashboardSilent: () => Promise<void>;
  hydrateExceptions: (options?: { force?: boolean }) => void;
  refreshExceptions: () => Promise<void>;
  refreshExceptionsSilent: () => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let dashboardFetch: Promise<void> | null = null;
let exceptionsFetch: Promise<void> | null = null;

function isDeskFresh(at: number | null): boolean {
  return isFresh(at, DESK_STALE_MS);
}

export const useAuditorDeskStore = create<State>((set, get) => ({
  branchId: "all",
  dashboard: null,
  auditLogs: [],
  pendingAccountant: 0,
  pendingBank: 0,
  dashboardLoading: false,
  exceptionsLoading: false,
  error: null,
  exceptionsError: null,
  lastDashboardAt: null,
  lastExceptionsAt: null,
  liveSyncActive: false,

  hydrateDashboard: (options) => {
    if (options?.branchId) {
      set({ branchId: options.branchId });
    }
    const { dashboardLoading, lastDashboardAt } = get();
    runHydrate({
      force: options?.force,
      loading: dashboardLoading,
      lastFetchedAt: lastDashboardAt,
      refresh: () => get().refreshDashboard(),
      refreshSilent: () => get().refreshDashboardSilent(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
  },

  refreshDashboard: async () => {
    if (dashboardFetch) {
      return dashboardFetch;
    }
    const { branchId } = get();
    set({ dashboardLoading: true, error: null });
    dashboardFetch = (async () => {
      try {
        const dashboard = await getAuditorDashboard({ branchId: branchId || "all" });
        set({ dashboard, lastDashboardAt: Date.now(), error: null });
      } catch (error) {
        set({ error: toUserFacingError(error, "Could not load auditor dashboard") });
      } finally {
        set({ dashboardLoading: false });
        dashboardFetch = null;
      }
    })();
    return dashboardFetch;
  },

  refreshDashboardSilent: async () => {
    if (dashboardFetch) {
      return dashboardFetch;
    }
    const { branchId } = get();
    dashboardFetch = (async () => {
      try {
        const dashboard = await getAuditorDashboard({ branchId: branchId || "all" });
        set({ dashboard, lastDashboardAt: Date.now(), error: null });
      } catch {
        /* keep stale */
      } finally {
        dashboardFetch = null;
      }
    })();
    return dashboardFetch;
  },

  hydrateExceptions: (options) => {
    const { exceptionsLoading, lastExceptionsAt } = get();
    runHydrate({
      force: options?.force,
      loading: exceptionsLoading,
      lastFetchedAt: lastExceptionsAt,
      refresh: () => get().refreshExceptions(),
      refreshSilent: () => get().refreshExceptionsSilent(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
  },

  refreshExceptions: async () => {
    if (exceptionsFetch) {
      return exceptionsFetch;
    }
    set({ exceptionsLoading: true, exceptionsError: null });
    exceptionsFetch = (async () => {
      try {
        const [logs, bootstrap] = await Promise.all([
          listAuditLogs({ limit: 200 }),
          getBackOfficeBootstrap({ branchId: "all" })
        ]);
        set({
          auditLogs: logs,
          pendingAccountant: bootstrap.pendingAccountantCount ?? 0,
          pendingBank:
            bootstrap.depositQueue?.filter((d) => d.executionStatus === "pending_bank").length ?? 0,
          lastExceptionsAt: Date.now(),
          exceptionsError: null
        });
      } catch (error) {
        set({
          exceptionsError: toUserFacingError(error, "Could not load exception review")
        });
      } finally {
        set({ exceptionsLoading: false });
        exceptionsFetch = null;
      }
    })();
    return exceptionsFetch;
  },

  refreshExceptionsSilent: async () => {
    if (exceptionsFetch) {
      return exceptionsFetch;
    }
    exceptionsFetch = (async () => {
      try {
        const [logs, bootstrap] = await Promise.all([
          listAuditLogs({ limit: 200 }),
          getBackOfficeBootstrap({ branchId: "all" })
        ]);
        set({
          auditLogs: logs,
          pendingAccountant: bootstrap.pendingAccountantCount ?? 0,
          pendingBank:
            bootstrap.depositQueue?.filter((d) => d.executionStatus === "pending_bank").length ?? 0,
          lastExceptionsAt: Date.now(),
          exceptionsError: null
        });
      } catch {
        /* keep stale */
      } finally {
        exceptionsFetch = null;
      }
    })();
    return exceptionsFetch;
  },

  startLiveSync: () => {
    if (get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: ["audit_logs", "transactions", "agency_deposits"],
      onRefresh: () => {
        void get().refreshDashboardSilent();
        void get().refreshExceptionsSilent();
      },
      isStale: () => !isDeskFresh(get().lastDashboardAt)
    });
  },

  stopLiveSync: () => {
    if (!get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: false });
    liveSync.stop();
  }
}));
