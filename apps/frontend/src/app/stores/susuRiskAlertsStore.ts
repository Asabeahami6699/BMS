import { create } from "zustand";
import type { DormantSusuCustomerAlert, ZeroCollectionAgentAlert } from "../api";
import { getTenantId, listDormantSusuCustomers, listZeroCollectionFieldAgentsToday } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import { createSilentRefreshScheduler, runHydrate } from "./storeSync";

type SusuRiskAlertsState = {
  tenantId: string | null;
  dormantDays: number;
  dormantCustomers: DormantSusuCustomerAlert[];
  zeroCollectionAgents: ZeroCollectionAgentAlert[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  setDormantDays: (days: number) => void;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
};

let fetchInFlight: Promise<void> | null = null;
let inFlightDays: number | null = null;
const silentScheduler = createSilentRefreshScheduler();

export const useSusuRiskAlertsStore = create<SusuRiskAlertsState>((set, get) => ({
  tenantId: null,
  dormantDays: 7,
  dormantCustomers: [],
  zeroCollectionAgents: [],
  loading: false,
  error: null,
  lastFetchedAt: null,

  setDormantDays: (days) => {
    const clean = Math.max(1, Math.floor(days));
    if (clean === get().dormantDays) return;
    set({ dormantDays: clean });
    void get().refresh();
  },

  hydrate: (options) => {
    const currentTenant = getTenantId();
    const { tenantId, loading, lastFetchedAt } = get();
    const tenantChanged = tenantId !== null && tenantId !== currentTenant;
    if (tenantChanged) {
      set({
        tenantId: currentTenant,
        dormantCustomers: [],
        zeroCollectionAgents: [],
        lastFetchedAt: null,
        error: null
      });
    }
    runHydrate({
      force: options?.force || tenantChanged,
      loading,
      lastFetchedAt: tenantChanged ? null : lastFetchedAt,
      refresh: () => get().refresh(),
      refreshSilent: () => get().refreshSilent(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
  },

  refresh: async () => {
    const requestedDays = get().dormantDays;
    if (fetchInFlight) {
      set({ loading: true });
      await fetchInFlight;
      if (get().dormantDays === requestedDays && inFlightDays === requestedDays) {
        set({ loading: false });
        return;
      }
    }
    const days = get().dormantDays;
    const tenantId = getTenantId();
    inFlightDays = days;
    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        const [dormantCustomers, zeroCollectionAgents] = await Promise.all([
          listDormantSusuCustomers({ days }),
          listZeroCollectionFieldAgentsToday().catch(() => [])
        ]);
        if (get().dormantDays === days && getTenantId() === tenantId) {
          set({
            tenantId,
            dormantCustomers,
            zeroCollectionAgents,
            lastFetchedAt: Date.now(),
            error: null
          });
        }
      } catch (err) {
        set({ error: toUserFacingError(err, "Failed to load Susu risk alerts") });
      } finally {
        fetchInFlight = null;
        set({ loading: false });
      }
    })();
    await fetchInFlight;
    if (get().dormantDays !== days) {
      await get().refresh();
    }
  },

  refreshSilent: async () => {
    if (fetchInFlight) {
      await fetchInFlight;
      return;
    }
    const days = get().dormantDays;
    const tenantId = getTenantId();
    inFlightDays = days;
    fetchInFlight = (async () => {
      try {
        const [dormantCustomers, zeroCollectionAgents] = await Promise.all([
          listDormantSusuCustomers({ days }),
          listZeroCollectionFieldAgentsToday().catch(() => [])
        ]);
        if (get().dormantDays === days && getTenantId() === tenantId) {
          set({
            tenantId,
            dormantCustomers,
            zeroCollectionAgents,
            lastFetchedAt: Date.now(),
            error: null
          });
        }
      } catch {
        /* keep stale cache on silent refresh failure */
      } finally {
        fetchInFlight = null;
      }
    })();
    await fetchInFlight;
  }
}));
