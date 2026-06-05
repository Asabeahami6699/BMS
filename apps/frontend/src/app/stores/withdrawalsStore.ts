import { create } from "zustand";
import type { BalanceDisclosure, Branch } from "../api";
import { getTenantId, getWithdrawalsBootstrap } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type WithdrawalsState = {
  withdrawals: BalanceDisclosure[];
  branches: Branch[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  branchFilter: string;
  liveSyncActive: boolean;
  hydrate: (options?: { force?: boolean }) => void;
  setBranchFilter: (branchId: string) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
  removeWithdrawal: (id: string) => void;
  patchWithdrawal: (row: BalanceDisclosure) => void;
};

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

function withdrawalsSnapshotKey(rows: BalanceDisclosure[]): string {
  return rows
    .map(
      (r) =>
        `${r.id}:${r.status}:${r.withdrawalAmount ?? 0}:${r.fulfillmentMode ?? ""}:${r.approvedAt ?? ""}`
    )
    .join("|");
}

export const useWithdrawalsStore = create<WithdrawalsState>((set, get) => ({
  withdrawals: [],
  branches: [],
  loading: false,
  error: null,
  lastFetchedAt: null,
  branchFilter: "",
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

  setBranchFilter: (branchId) => {
    set({ branchFilter: branchId });
    lastSnapshotKey = "";
    void get().refresh();
  },

  removeWithdrawal: (id) => {
    lastSnapshotKey = "";
    set((state) => ({
      withdrawals: state.withdrawals.filter((r) => r.id !== id)
    }));
  },

  patchWithdrawal: (row) => {
    lastSnapshotKey = "";
    set((state) => ({
      withdrawals: state.withdrawals.map((r) => (r.id === row.id ? row : r))
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
        const data = await getWithdrawalsBootstrap(get().branchFilter || undefined);
        const key = withdrawalsSnapshotKey(data.withdrawals);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            withdrawals: data.withdrawals,
            branches: data.branches,
            lastFetchedAt: Date.now(),
            error: null
          });
        }
      } catch (error) {
        set({ error: toUserFacingError(error, "Failed to load withdrawals") });
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
        const data = await getWithdrawalsBootstrap(get().branchFilter || undefined);
        const key = withdrawalsSnapshotKey(data.withdrawals);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            withdrawals: data.withdrawals,
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
      tables: ["customer_balance_disclosures", "customer_transactions", "customers"],
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

export function selectWithdrawalKpis(withdrawals: BalanceDisclosure[]) {
  const pending = withdrawals.filter((r) => r.status === "pending");
  const approved = withdrawals.filter((r) => r.status === "approved");
  const rejected = withdrawals.filter((r) => r.status === "rejected");
  const pendingAmount = pending.reduce((sum, r) => sum + (r.withdrawalAmount ?? 0), 0);
  return {
    total: withdrawals.length,
    pending: pending.length,
    approved: approved.length,
    rejected: rejected.length,
    pendingAmount
  };
}
