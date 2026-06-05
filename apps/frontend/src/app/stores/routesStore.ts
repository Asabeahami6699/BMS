import { create } from "zustand";
import type { Branch, FieldRoute } from "../api";
import { getRoutesBootstrap, getTenantId } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type RoutesState = {
  routes: FieldRoute[];
  branches: Branch[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
  patchRoute: (route: FieldRoute) => void;
  removeRoute: (routeId: string) => void;
};

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

function routesSnapshotKey(routes: FieldRoute[]): string {
  return routes
    .map(
      (r) =>
        `${r.id}:${r.status}:${r.name}:${r.memberCount ?? 0}:${r.assignedFieldAgentId ?? ""}`
    )
    .join("|");
}

export const useRoutesStore = create<RoutesState>((set, get) => ({
  routes: [],
  branches: [],
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
        const key = routesSnapshotKey(data.routes);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            routes: data.routes,
            branches: data.branches,
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
        const key = routesSnapshotKey(data.routes);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            routes: data.routes,
            branches: data.branches,
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

  startLiveSync: () => {
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: ["field_routes", "customers"],
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
