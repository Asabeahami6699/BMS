import { create } from "zustand";
import {
  SITE_MANUAL_DEPARTMENTS,
  type SiteManualArticle,
  type TenantProductModule
} from "@bms/shared";
import { getSiteManual, getTenantId } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type SiteManualState = {
  departments: typeof SITE_MANUAL_DEPARTMENTS;
  articles: SiteManualArticle[];
  modules: TenantProductModule[];
  bridgeActive: boolean;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
};

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();

function catalogSnapshotKey(
  articles: SiteManualArticle[],
  modules: TenantProductModule[],
  bridgeActive: boolean
): string {
  return `${bridgeActive}|${modules.join(",")}|${articles.map((a) => a.id).join(",")}`;
}

export const useSiteManualStore = create<SiteManualState>((set, get) => ({
  departments: SITE_MANUAL_DEPARTMENTS,
  articles: [],
  modules: [],
  bridgeActive: false,
  loading: false,
  error: null,
  lastFetchedAt: null,

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
      set({ loading: true });
      await fetchInFlight;
      set({ loading: false });
      return;
    }

    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        // Always load the full tenant-scoped catalog once; search filters client-side.
        const data = await getSiteManual();
        const key = catalogSnapshotKey(data.articles, data.modules, data.bridgeActive);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            articles: data.articles,
            modules: data.modules,
            bridgeActive: data.bridgeActive,
            departments: SITE_MANUAL_DEPARTMENTS,
            lastFetchedAt: Date.now(),
            error: null
          });
        } else {
          set({ lastFetchedAt: Date.now(), error: null });
        }
      } catch (error) {
        set({
          error: toUserFacingError(error, "Failed to load site manual"),
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
        const data = await getSiteManual();
        const key = catalogSnapshotKey(data.articles, data.modules, data.bridgeActive);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            articles: data.articles,
            modules: data.modules,
            bridgeActive: data.bridgeActive,
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
  }
}));

export function prefetchSiteManual(): void {
  void getTenantId();
  useSiteManualStore.getState().hydrate();
}
