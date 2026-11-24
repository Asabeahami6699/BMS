import { create } from "zustand";
import type {
  AnnouncementScope,
  CreateSiteAnnouncementInput,
  SiteAnnouncement,
  UpdateSiteAnnouncementInput
} from "@bms/shared";
import {
  createSiteAnnouncementApi,
  deleteSiteAnnouncementApi,
  getTenantId,
  listActiveSiteAnnouncements,
  listManagedSiteAnnouncements,
  updateSiteAnnouncementApi
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  runHydrate
} from "./storeSync";

const DISMISS_STORAGE_KEY = "bms_dismissed_site_announcements_v1";

function loadDismissed(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveDismissed(map: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore storage quota */
  }
}

type SiteAnnouncementsState = {
  tenantId: string | null;
  active: SiteAnnouncement[];
  activeLoading: boolean;
  activeLastFetchedAt: number | null;

  managedScope: AnnouncementScope | null;
  managed: SiteAnnouncement[];
  managedLoading: boolean;
  saving: boolean;
  busyId: string | null;
  error: string | null;
  lastFetchedAt: number | null;

  dismissedKeys: Record<string, string>;

  hydrateActive: (options?: { force?: boolean }) => void;
  refreshActive: () => Promise<void>;
  refreshActiveSilent: () => Promise<void>;
  startActiveLiveSync: () => void;
  stopActiveLiveSync: () => void;

  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;

  create: (input: CreateSiteAnnouncementInput) => Promise<SiteAnnouncement>;
  update: (id: string, input: UpdateSiteAnnouncementInput) => Promise<SiteAnnouncement>;
  stopNow: (id: string) => Promise<SiteAnnouncement>;
  extendTimer: (id: string, minutes: number) => Promise<SiteAnnouncement>;
  remove: (id: string) => Promise<void>;
  dismiss: (announcement: SiteAnnouncement) => void;
  resetDismissals: () => void;
};

let activeInFlight: Promise<void> | null = null;
let managedInFlight: Promise<void> | null = null;
const activeSilentScheduler = createSilentRefreshScheduler(1_000);
const managedSilentScheduler = createSilentRefreshScheduler(1_200);
const activeLiveSync = createLiveSyncManager();
const managedLiveSync = createLiveSyncManager();

export const useSiteAnnouncementsStore = create<SiteAnnouncementsState>((set, get) => ({
  tenantId: null,
  active: [],
  activeLoading: false,
  activeLastFetchedAt: null,

  managedScope: null,
  managed: [],
  managedLoading: false,
  saving: false,
  busyId: null,
  error: null,
  lastFetchedAt: null,

  dismissedKeys: loadDismissed(),

  hydrateActive: (options) => {
    const currentTenant = getTenantId();
    const { tenantId, activeLoading, activeLastFetchedAt } = get();
    const tenantChanged = tenantId !== null && tenantId !== currentTenant;
    if (tenantChanged) {
      set({
        tenantId: currentTenant,
        active: [],
        activeLastFetchedAt: null,
        managed: [],
        lastFetchedAt: null
      });
    }
    runHydrate({
      force: options?.force || tenantChanged,
      loading: activeLoading,
      lastFetchedAt: tenantChanged ? null : activeLastFetchedAt,
      refresh: () => get().refreshActive(),
      refreshSilent: () => get().refreshActiveSilent(),
      scheduleSilent: (run) => activeSilentScheduler.schedule(run)
    });
  },

  refreshActive: async () => {
    if (activeInFlight) {
      await activeInFlight;
      return;
    }
    const tenantId = getTenantId();
    set({ activeLoading: true });
    activeInFlight = (async () => {
      try {
        const res = await listActiveSiteAnnouncements();
        if (getTenantId() === tenantId) {
          set({
            tenantId,
            active: res.announcements,
            activeLastFetchedAt: Date.now()
          });
        }
      } catch {
        /* non-blocking floating banner fetch */
      } finally {
        activeInFlight = null;
        set({ activeLoading: false });
      }
    })();
    await activeInFlight;
  },

  refreshActiveSilent: async () => {
    if (activeInFlight) {
      await activeInFlight;
      return;
    }
    const tenantId = getTenantId();
    activeInFlight = (async () => {
      try {
        const res = await listActiveSiteAnnouncements();
        if (getTenantId() === tenantId) {
          set({
            tenantId,
            active: res.announcements,
            activeLastFetchedAt: Date.now()
          });
        }
      } catch {
        /* keep cached announcements on background failure */
      } finally {
        activeInFlight = null;
      }
    })();
    await activeInFlight;
  },

  startActiveLiveSync: () => {
    activeLiveSync.start({
      getTenantId,
      tables: ["site_announcements"],
      onRefresh: () => void get().refreshActiveSilent(),
      // Poll every 45s so super-admin (platform-wide, tenant_id IS NULL) announcements appear promptly everywhere.
      pollMs: 45_000
    });
  },

  stopActiveLiveSync: () => {
    activeLiveSync.stop();
  },

  hydrate: (options) => {
    const currentTenant = getTenantId();
    const { tenantId, managedLoading, lastFetchedAt } = get();
    const tenantChanged = tenantId !== null && tenantId !== currentTenant;
    if (tenantChanged) {
      set({
        tenantId: currentTenant,
        managed: [],
        lastFetchedAt: null,
        error: null
      });
    }
    runHydrate({
      force: options?.force || tenantChanged,
      loading: managedLoading,
      lastFetchedAt: tenantChanged ? null : lastFetchedAt,
      refresh: () => get().refresh(),
      refreshSilent: () => get().refreshSilent(),
      scheduleSilent: (run) => managedSilentScheduler.schedule(run)
    });
  },

  refresh: async () => {
    if (managedInFlight) {
      set({ managedLoading: true });
      await managedInFlight;
      set({ managedLoading: false });
      return;
    }
    const tenantId = getTenantId();
    set({ managedLoading: true, error: null });
    managedInFlight = (async () => {
      try {
        const res = await listManagedSiteAnnouncements();
        if (getTenantId() === tenantId) {
          set({
            tenantId,
            managedScope: res.scope,
            managed: res.announcements,
            lastFetchedAt: Date.now(),
            error: null
          });
        }
      } catch (err) {
        set({ error: toUserFacingError(err, "Failed to load announcements") });
      } finally {
        managedInFlight = null;
        set({ managedLoading: false });
      }
    })();
    await managedInFlight;
  },

  refreshSilent: async () => {
    if (managedInFlight) {
      await managedInFlight;
      return;
    }
    const tenantId = getTenantId();
    managedInFlight = (async () => {
      try {
        const res = await listManagedSiteAnnouncements();
        if (getTenantId() === tenantId) {
          set({
            tenantId,
            managedScope: res.scope,
            managed: res.announcements,
            lastFetchedAt: Date.now(),
            error: null
          });
        }
      } catch {
        /* keep stale cache on silent refresh failure */
      } finally {
        managedInFlight = null;
      }
    })();
    await managedInFlight;
  },

  startLiveSync: () => {
    managedLiveSync.start({
      getTenantId,
      tables: ["site_announcements"],
      onRefresh: () => void get().refreshSilent(),
      pollMs: 60_000
    });
  },

  stopLiveSync: () => {
    managedLiveSync.stop();
  },

  create: async (input) => {
    set({ saving: true, error: null });
    try {
      const created = await createSiteAnnouncementApi(input);
      await Promise.all([get().refreshSilent(), get().refreshActiveSilent()]);
      return created;
    } finally {
      set({ saving: false });
    }
  },

  update: async (id, input) => {
    set({ busyId: id, error: null });
    try {
      const updated = await updateSiteAnnouncementApi(id, input);
      await Promise.all([get().refreshSilent(), get().refreshActiveSilent()]);
      return updated;
    } finally {
      set({ busyId: null });
    }
  },

  stopNow: async (id) => {
    return get().update(id, { isActive: false });
  },

  extendTimer: async (id, minutes) => {
    return get().update(id, { extendMinutes: minutes });
  },

  remove: async (id) => {
    set({ busyId: id, error: null });
    try {
      await deleteSiteAnnouncementApi(id);
      set((s) => ({
        managed: s.managed.filter((item) => item.id !== id),
        active: s.active.filter((item) => item.id !== id)
      }));
      void get().refreshActiveSilent();
    } finally {
      set({ busyId: null });
    }
  },

  dismiss: (announcement) => {
    const next = { ...get().dismissedKeys, [announcement.id]: announcement.updatedAt };
    saveDismissed(next);
    set({ dismissedKeys: next });
  },

  resetDismissals: () => {
    saveDismissed({});
    set({ dismissedKeys: {} });
  }
}));
