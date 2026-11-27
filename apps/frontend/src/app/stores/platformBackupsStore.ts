import { create } from "zustand";
import {
  downloadPlatformAllTenantsSnapshot,
  downloadPlatformTenantBalancesCsv,
  downloadPlatformTenantSnapshot,
  getPlatformBackupOverview,
  verifyPlatformTenantAuditChain,
  type PlatformAuditChainResult,
  type PlatformBackupOverview
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import { createSilentRefreshScheduler, runHydrate } from "./storeSync";

type PlatformBackupsState = {
  overview: PlatformBackupOverview | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  verifyingTenantId: string | null;
  downloadingKey: string | null;
  chainResultsByTenant: Record<string, PlatformAuditChainResult>;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  verifyChain: (tenantId: string) => Promise<PlatformAuditChainResult>;
  downloadTenantJson: (
    tenantId: string,
    options?: { includePhotos?: boolean }
  ) => Promise<{ filename: string; sha256: string | null; sizeBytes: number }>;
  downloadTenantCsv: (
    tenantId: string
  ) => Promise<{ filename: string; sha256: string | null; sizeBytes: number }>;
  downloadAllJson: (options?: {
    includePhotos?: boolean;
  }) => Promise<{ filename: string; sha256: string | null; sizeBytes: number }>;
};

let fetchInFlight: Promise<void> | null = null;
const silentScheduler = createSilentRefreshScheduler();

export const usePlatformBackupsStore = create<PlatformBackupsState>((set, get) => ({
  overview: null,
  loading: false,
  error: null,
  lastFetchedAt: null,
  verifyingTenantId: null,
  downloadingKey: null,
  chainResultsByTenant: {},

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
    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        const overview = await getPlatformBackupOverview();
        set({
          overview,
          lastFetchedAt: Date.now(),
          error: null
        });
      } catch (error) {
        set({ error: toUserFacingError(error, "Failed to load backup overview") });
      } finally {
        set({ loading: false });
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
        const overview = await getPlatformBackupOverview();
        set({
          overview,
          lastFetchedAt: Date.now(),
          error: null
        });
      } catch {
        /* keep existing cached overview */
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  verifyChain: async (tenantId) => {
    set({ verifyingTenantId: tenantId });
    try {
      const result = await verifyPlatformTenantAuditChain(tenantId);
      set((state) => ({
        chainResultsByTenant: {
          ...state.chainResultsByTenant,
          [tenantId]: result
        }
      }));
      return result;
    } finally {
      set({ verifyingTenantId: null });
    }
  },

  downloadTenantJson: async (tenantId, options) => {
    const key = `json:${tenantId}`;
    set({ downloadingKey: key });
    try {
      return await downloadPlatformTenantSnapshot(tenantId, options);
    } finally {
      set({ downloadingKey: null });
    }
  },

  downloadTenantCsv: async (tenantId) => {
    const key = `csv:${tenantId}`;
    set({ downloadingKey: key });
    try {
      return await downloadPlatformTenantBalancesCsv(tenantId);
    } finally {
      set({ downloadingKey: null });
    }
  },

  downloadAllJson: async (options) => {
    set({ downloadingKey: "json:all" });
    try {
      return await downloadPlatformAllTenantsSnapshot(options);
    } finally {
      set({ downloadingKey: null });
    }
  }
}));
