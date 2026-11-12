import { create } from "zustand";
import type { TenantRecord } from "../api";
import { listPlatformTenants } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type PlatformAdminState = {
  tenants: TenantRecord[];
  loading: boolean;
  error: string | null;
  statusMessage: string;
  lastFetchedAt: number | null;

  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  patchTenant: (tenant: TenantRecord) => void;
  setTenants: (tenants: TenantRecord[]) => void;
};

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();

function tenantsSnapshotKey(tenants: TenantRecord[]): string {
  return tenants
    .map(
      (t) =>
        `${t.id}:${t.subscriptionStatus}:${t.billingStatus ?? ""}:${t.periodEnd ?? ""}:${(t.subscribedModules ?? []).join(",")}:${(t.subscribedAddons ?? []).join(",")}:${t.subdomain ?? ""}:${t.name}`
    )
    .join("|");
}

export const usePlatformAdminStore = create<PlatformAdminState>((set, get) => ({
  tenants: [],
  loading: false,
  error: null,
  statusMessage: "",
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

  patchTenant: (tenant) => {
    set({
      tenants: get().tenants.map((row) => (row.id === tenant.id ? tenant : row))
    });
  },

  setTenants: (tenants) => {
    set({
      tenants,
      statusMessage: tenants.length === 0 ? "No companies registered yet." : "",
      lastFetchedAt: Date.now()
    });
  },

  refresh: async () => {
    if (fetchInFlight) {
      set({ loading: true });
      await fetchInFlight;
      set({ loading: false });
      return;
    }

    set({ loading: true, error: null, statusMessage: "Loading companies..." });
    fetchInFlight = (async () => {
      try {
        const tenants = await listPlatformTenants();
        const key = tenantsSnapshotKey(tenants);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            tenants,
            statusMessage: tenants.length === 0 ? "No companies registered yet." : "",
            lastFetchedAt: Date.now(),
            error: null
          });
        } else {
          set({
            lastFetchedAt: Date.now(),
            error: null,
            statusMessage: tenants.length === 0 ? "No companies registered yet." : ""
          });
        }
      } catch (error) {
        const message = toUserFacingError(error, "Failed to load companies");
        set({
          error: message,
          statusMessage: message,
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
        const tenants = await listPlatformTenants();
        const key = tenantsSnapshotKey(tenants);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            tenants,
            statusMessage: tenants.length === 0 ? "No companies registered yet." : "",
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
