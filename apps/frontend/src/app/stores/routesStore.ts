import { create } from "zustand";
import type {
  BulkReorganizeCustomersInput,
  BulkReorganizeResult,
  CustomerAssignmentHistory,
  TenantRouteSettings,
  UpdateTenantRouteSettingsInput
} from "@bms/shared";
import type { Branch, FieldRoute } from "../api";
import {
  applyRouteReorganization,
  getRoutesBootstrap,
  getTenantId,
  listRouteAssignmentHistory,
  updateTenantRouteSettings
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";
import { useCustomersStore } from "./customersStore";

type RoutesState = {
  routes: FieldRoute[];
  branches: Branch[];
  settings: TenantRouteSettings | null;
  assignmentHistory: CustomerAssignmentHistory[];
  loading: boolean;
  savingSettings: boolean;
  historyLoading: boolean;
  reorganizing: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  saveSettings: (input: UpdateTenantRouteSettingsInput) => Promise<TenantRouteSettings>;
  loadAssignmentHistory: (options?: { branchId?: string; customerId?: string; limit?: number }) => Promise<void>;
  applyReorganization: (input: BulkReorganizeCustomersInput) => Promise<BulkReorganizeResult>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
  patchRoute: (route: FieldRoute) => void;
  removeRoute: (routeId: string) => void;
};

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

function routesSnapshotKey(
  routes: FieldRoute[],
  branches: Branch[],
  settings?: TenantRouteSettings
): string {
  const routeKey = routes
    .map(
      (r) =>
        `${r.id}:${r.status}:${r.name}:${r.area}:${(r.communities ?? []).join(",")}:${r.memberCount ?? 0}:${r.assignedFieldAgentId ?? ""}`
    )
    .join("|");
  const branchKey = branches.map((b) => `${b.id}:${b.status}:${b.name}:${b.code}`).join("|");
  const settingsKey = settings
    ? `${settings.strategy}:${settings.autoAssignOnApproval}:${settings.syncAgentOnRouteChange}:${settings.storageReady ?? true}`
    : "";
  return `${routeKey}#${branchKey}#${settingsKey}`;
}

export const useRoutesStore = create<RoutesState>((set, get) => ({
  routes: [],
  branches: [],
  settings: null,
  assignmentHistory: [],
  loading: false,
  savingSettings: false,
  historyLoading: false,
  reorganizing: false,
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

  patchRoute: (route) => {
    lastSnapshotKey = "";
    set((state) => ({
      routes: state.routes.map((r) => (r.id === route.id ? route : r))
    }));
  },

  removeRoute: (routeId) => {
    lastSnapshotKey = "";
    set((state) => ({
      routes: state.routes.filter((r) => r.id !== routeId)
    }));
  },

  refresh: async () => {
    if (fetchInFlight) {
      set({ loading: true });
      await fetchInFlight;
      set({ loading: false });
      return;
    }

    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        const data = await getRoutesBootstrap();
        const key = routesSnapshotKey(data.routes, data.branches, data.settings);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            routes: data.routes,
            branches: data.branches,
            settings: data.settings ?? get().settings,
            lastFetchedAt: Date.now(),
            error: null
          });
        }
      } catch (error) {
        set({ error: toUserFacingError(error, "Failed to load routes") });
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
        const data = await getRoutesBootstrap();
        const key = routesSnapshotKey(data.routes, data.branches, data.settings);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            routes: data.routes,
            branches: data.branches,
            settings: data.settings ?? get().settings,
            lastFetchedAt: Date.now(),
            error: null
          });
        }
      } catch {
        /* keep cache */
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  saveSettings: async (input) => {
    set({ savingSettings: true, error: null });
    try {
      const updated = await updateTenantRouteSettings(input);
      lastSnapshotKey = "";
      set({ settings: updated, savingSettings: false });
      return updated;
    } catch (error) {
      const message = toUserFacingError(error, "Failed to update route assignment settings");
      set({ savingSettings: false, error: message });
      throw new Error(message);
    }
  },

  loadAssignmentHistory: async (options) => {
    set({ historyLoading: true });
    try {
      const rows = await listRouteAssignmentHistory(options);
      set({ assignmentHistory: rows, historyLoading: false });
    } catch {
      set({ historyLoading: false });
    }
  },

  applyReorganization: async (input) => {
    set({ reorganizing: true, error: null });
    try {
      const result = await applyRouteReorganization(input);
      lastSnapshotKey = "";
      set({ reorganizing: false });
      await Promise.all([
        get().refreshSilent(),
        useCustomersStore.getState().refreshSilent(),
        get().loadAssignmentHistory({ branchId: input.branchId, limit: 100 })
      ]);
      return result;
    } catch (error) {
      const message = toUserFacingError(error, "Failed to apply route reorganization");
      set({ reorganizing: false, error: message });
      throw new Error(message);
    }
  },

  startLiveSync: () => {
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: [
        "field_routes",
        "customers",
        "branches",
        "tenant_route_settings",
        "customer_assignment_history"
      ],
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt)
    });
  },

  stopLiveSync: () => {
    liveSync.stop();
    silentScheduler.clear();
    set({ liveSyncActive: false });
  }
}));
