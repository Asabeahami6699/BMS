import { create } from "zustand";
import {
  commitPlatformTenantMigration,
  getPlatformTenantMigrationContext,
  previewPlatformTenantMigration,
  type PlatformTenantMigrationCommitResult,
  type PlatformTenantMigrationContext,
  type PlatformTenantMigrationPreview
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import { createSilentRefreshScheduler, runHydrate } from "./storeSync";

type PlatformMigrationState = {
  selectedTenantId: string;
  contextByTenant: Record<string, PlatformTenantMigrationContext>;
  loadingContext: boolean;
  previewing: boolean;
  committing: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  preview: PlatformTenantMigrationPreview | null;
  commitResult: PlatformTenantMigrationCommitResult | null;
  setSelectedTenantId: (tenantId: string) => void;
  hydrateContext: (tenantId: string, options?: { force?: boolean }) => void;
  refreshContext: (tenantId: string) => Promise<void>;
  refreshContextSilent: (tenantId: string) => Promise<void>;
  runPreview: (
    tenantId: string,
    payload: {
      csvText: string;
      cutoverDate: string;
      defaultBranchCode?: string;
      defaultKycTier?: "simplified" | "full";
      skipDuplicatePhones?: boolean;
    }
  ) => Promise<PlatformTenantMigrationPreview>;
  runCommit: (
    tenantId: string,
    payload: {
      csvText: string;
      cutoverDate: string;
      defaultBranchCode?: string;
      defaultKycTier?: "simplified" | "full";
      skipDuplicatePhones?: boolean;
      expectedTotalBalance?: number;
    }
  ) => Promise<PlatformTenantMigrationCommitResult>;
  clearResults: () => void;
};

const contextInFlight = new Map<string, Promise<void>>();
const contextFetchedAt = new Map<string, number>();
const silentScheduler = createSilentRefreshScheduler();

export const usePlatformMigrationStore = create<PlatformMigrationState>((set, get) => ({
  selectedTenantId: "",
  contextByTenant: {},
  loadingContext: false,
  previewing: false,
  committing: false,
  error: null,
  lastFetchedAt: null,
  preview: null,
  commitResult: null,

  setSelectedTenantId: (tenantId) => {
    set({
      selectedTenantId: tenantId,
      preview: null,
      commitResult: null,
      error: null
    });
    if (tenantId) {
      get().hydrateContext(tenantId);
    }
  },

  hydrateContext: (tenantId, options) => {
    if (!tenantId) return;
    const lastAt = contextFetchedAt.get(tenantId) ?? null;
    runHydrate({
      force: options?.force,
      loading: get().loadingContext && get().selectedTenantId === tenantId,
      lastFetchedAt: lastAt,
      refresh: () => get().refreshContext(tenantId),
      refreshSilent: () => get().refreshContextSilent(tenantId),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
  },

  refreshContext: async (tenantId) => {
    if (!tenantId) return;
    const existing = contextInFlight.get(tenantId);
    if (existing) return existing;

    set({ loadingContext: true, error: null });
    const req = (async () => {
      try {
        const ctx = await getPlatformTenantMigrationContext(tenantId);
        const now = Date.now();
        contextFetchedAt.set(tenantId, now);
        set((state) => ({
          contextByTenant: { ...state.contextByTenant, [tenantId]: ctx },
          lastFetchedAt: now,
          error: null
        }));
      } catch (err) {
        set({ error: toUserFacingError(err, "Failed to load tenant migration context") });
      } finally {
        set({ loadingContext: false });
        contextInFlight.delete(tenantId);
      }
    })();
    contextInFlight.set(tenantId, req);
    return req;
  },

  refreshContextSilent: async (tenantId) => {
    if (!tenantId) return;
    const existing = contextInFlight.get(tenantId);
    if (existing) return existing;

    const req = (async () => {
      try {
        const ctx = await getPlatformTenantMigrationContext(tenantId);
        const now = Date.now();
        contextFetchedAt.set(tenantId, now);
        set((state) => ({
          contextByTenant: { ...state.contextByTenant, [tenantId]: ctx },
          lastFetchedAt: now
        }));
      } catch {
        // Silent background refresh ignores transient failures
      } finally {
        contextInFlight.delete(tenantId);
      }
    })();
    contextInFlight.set(tenantId, req);
    return req;
  },

  runPreview: async (tenantId, payload) => {
    set({ previewing: true, error: null, commitResult: null });
    try {
      const preview = await previewPlatformTenantMigration(tenantId, payload);
      set({ preview, error: null });
      return preview;
    } catch (err) {
      const msg = toUserFacingError(err, "Failed to validate migration CSV");
      set({ error: msg, preview: null });
      throw new Error(msg);
    } finally {
      set({ previewing: false });
    }
  },

  runCommit: async (tenantId, payload) => {
    set({ committing: true, error: null });
    try {
      const result = await commitPlatformTenantMigration(tenantId, payload);
      set({ commitResult: result, error: null });
      // Refresh tenant context quietly so existingCustomerCount stays accurate
      void get().refreshContextSilent(tenantId);
      return result;
    } catch (err) {
      const msg = toUserFacingError(err, "Failed to commit opening balances");
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ committing: false });
    }
  },

  clearResults: () => {
    set({ preview: null, commitResult: null, error: null });
  }
}));
