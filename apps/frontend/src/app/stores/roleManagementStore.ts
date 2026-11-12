import { create } from "zustand";
import type {
  BuiltinRolePermissionView,
  RoleDefinition,
  SusuNavVisibilityConfigItem,
  UserRecord
} from "../api";
import {
  getBuiltinRolePermissions,
  getRoleAssignments,
  getRoles,
  getSusuNavVisibilityConfig,
  getTenantId
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";
import { useUsersStore } from "./usersStore";

type RoleAssignment = { userId: string; roleKey: string };

type RoleManagementState = {
  roles: RoleDefinition[];
  assignments: RoleAssignment[];
  builtinViews: BuiltinRolePermissionView[];
  navItems: SusuNavVisibilityConfigItem[];
  users: UserRecord[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;

  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
  setNavItems: (
    navItems:
      | SusuNavVisibilityConfigItem[]
      | ((prev: SusuNavVisibilityConfigItem[]) => SusuNavVisibilityConfigItem[])
  ) => void;
  setBuiltinViews: (
    views:
      | BuiltinRolePermissionView[]
      | ((prev: BuiltinRolePermissionView[]) => BuiltinRolePermissionView[])
  ) => void;
};

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

function snapshotKey(data: {
  roles: RoleDefinition[];
  assignments: RoleAssignment[];
  builtinViews: BuiltinRolePermissionView[];
  navItems: SusuNavVisibilityConfigItem[];
  users: UserRecord[];
}): string {
  return JSON.stringify({
    roles: data.roles.map((r) => `${r.roleKey}:${r.duties?.join(",") ?? ""}`),
    assignments: data.assignments.map((a) => `${a.userId}:${a.roleKey}`),
    builtin: data.builtinViews.map((v) => `${v.role}:${v.effectiveDuties.join(",")}`),
    nav: data.navItems.map((n) => `${n.navPath}:${n.roles.join(",")}`),
    users: data.users.map((u) => u.userId)
  });
}

export const useRoleManagementStore = create<RoleManagementState>((set, get) => ({
  roles: [],
  assignments: [],
  builtinViews: [],
  navItems: [],
  users: [],
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

  setNavItems: (navItems) => {
    set({
      navItems: typeof navItems === "function" ? navItems(get().navItems) : navItems
    });
  },

  setBuiltinViews: (builtinViews) => {
    set({
      builtinViews:
        typeof builtinViews === "function" ? builtinViews(get().builtinViews) : builtinViews
    });
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
        const [roles, assignmentData, builtin, nav] = await Promise.all([
          getRoles(),
          getRoleAssignments(),
          getBuiltinRolePermissions(),
          getSusuNavVisibilityConfig(),
          useUsersStore.getState().refresh().catch(() => undefined)
        ]);
        const userRows = useUsersStore.getState().users;
        const key = snapshotKey({
          roles,
          assignments: assignmentData,
          builtinViews: builtin,
          navItems: nav,
          users: userRows
        });
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            roles,
            assignments: assignmentData,
            builtinViews: builtin,
            navItems: nav,
            users: userRows,
            lastFetchedAt: Date.now(),
            error: null
          });
        } else {
          set({ lastFetchedAt: Date.now(), error: null });
        }
      } catch (error) {
        set({
          error: toUserFacingError(error, "Failed to load roles"),
          lastFetchedAt: Date.now()
        });
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
    if (isFresh(get().lastFetchedAt)) {
      return;
    }
    fetchInFlight = (async () => {
      try {
        const [roles, assignmentData, builtin, nav] = await Promise.all([
          getRoles(),
          getRoleAssignments(),
          getBuiltinRolePermissions(),
          getSusuNavVisibilityConfig(),
          useUsersStore.getState().refreshSilent().catch(() => undefined)
        ]);
        const userRows = useUsersStore.getState().users;
        const key = snapshotKey({
          roles,
          assignments: assignmentData,
          builtinViews: builtin,
          navItems: nav,
          users: userRows
        });
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            roles,
            assignments: assignmentData,
            builtinViews: builtin,
            navItems: nav,
            users: userRows,
            lastFetchedAt: Date.now(),
            error: null
          });
        } else {
          set({ lastFetchedAt: Date.now() });
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
    if (get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: [
        "tenant_roles",
        "user_role_assignments",
        "tenant_builtin_role_overrides",
        "tenant_susu_nav_overrides"
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
