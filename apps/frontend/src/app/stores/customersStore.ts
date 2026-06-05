import { create } from "zustand";
import type { Branch, Customer } from "../api";
import { getCustomerBootstrap, getTenantId } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type CustomersState = {
  customers: Customer[];
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
};

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

function bootstrapSnapshotKey(customers: Customer[], branches: Branch[]): string {
  const customerSig = customers
    .map(
      (c) =>
        `${c.id}\t${c.status}\t${c.fullName}\t${c.phone}\t${c.accountNumber ?? ""}\t${c.accountBalance ?? ""}\t${c.assignedFieldAgentId ?? ""}\t${c.assignedFieldAgentName ?? ""}`
    )
    .join("\n");
  const branchSig = branches.map((b) => `${b.id}\t${b.status}\t${b.name}`).join("\n");
  return `${customers.length}|${customerSig}|${branchSig}`;
}

function applyBootstrap(
  customers: Customer[],
  branches: Branch[]
): Partial<CustomersState> | null {
  const key = bootstrapSnapshotKey(customers, branches);
  if (key === lastSnapshotKey) {
    return null;
  }
  lastSnapshotKey = key;
  return {
    customers,
    branches,
    lastFetchedAt: Date.now(),
    error: null
  };
}

export const useCustomersStore = create<CustomersState>((set, get) => ({
  customers: [],
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
        const data = await getCustomerBootstrap();
        const patch = applyBootstrap(data.customers, data.branches);
        if (patch) {
          set(patch);
        }
      } catch (error) {
        set({ error: toUserFacingError(error, "Failed to load customers") });
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
        const data = await getCustomerBootstrap();
        const patch = applyBootstrap(data.customers, data.branches);
        if (patch) {
          set(patch);
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
      tables: ["customers"],
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
