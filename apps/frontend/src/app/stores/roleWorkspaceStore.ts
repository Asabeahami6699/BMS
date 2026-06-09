import { create } from "zustand";
import type { AgencyBootstrap } from "@bms/shared";
import type { BalanceDisclosure } from "../api";
import {
  approveBalanceDisclosure,
  executeAgencyBankDeposit,
  getActiveBranchFilter,
  getAgencyBootstrap,
  getTenantId,
  getWithdrawalsBootstrap,
  rejectBalanceDisclosure,
  tellerPayAgencyWithdrawal
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

export type RoleWorkspaceKind =
  | "teller"
  | "customer_service"
  | "back_officer"
  | "accountant"
  | "auditor"
  | "hrm"
  | "operations";

type RoleWorkspaceState = {
  kind: RoleWorkspaceKind | null;
  branchId: string | null;
  agency: AgencyBootstrap | null;
  withdrawals: BalanceDisclosure[];
  loading: boolean;
  busyId: string | null;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;

  setKind: (kind: RoleWorkspaceKind) => void;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  executeDeposit: (transactionId: string) => Promise<void>;
  payWithdrawal: (disclosureId: string) => Promise<void>;
  verifyWithdrawal: (
    disclosureId: string,
    bankProductId?: string,
    workflowData?: Record<string, unknown>
  ) => Promise<BalanceDisclosure>;
  declineWithdrawal: (disclosureId: string, reason?: string) => Promise<BalanceDisclosure>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let fetchInFlight: Promise<void> | null = null;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

function needsWithdrawals(kind: RoleWorkspaceKind | null): boolean {
  return kind === "operations";
}

function needsAgency(kind: RoleWorkspaceKind | null): boolean {
  return (
    kind === "teller" ||
    kind === "customer_service" ||
    kind === "back_officer" ||
    kind === "operations"
  );
}

function liveSyncTables(kind: RoleWorkspaceKind | null): string[] {
  if (kind === "customer_service") {
    return ["customer_balance_disclosures", "customer_transactions"];
  }
  if (kind === "teller" || kind === "back_officer") {
    return ["customer_transactions", "customer_balance_disclosures"];
  }
  return [];
}

export const useRoleWorkspaceStore = create<RoleWorkspaceState>((set, get) => ({
  kind: null,
  branchId: getActiveBranchFilter() ?? null,
  agency: null,
  withdrawals: [],
  loading: false,
  busyId: null,
  error: null,
  lastFetchedAt: null,
  liveSyncActive: false,

  setKind: (kind) => {
    if (get().kind !== kind) {
      set({ kind, agency: null, withdrawals: [], lastFetchedAt: null, error: null });
    }
  },

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
    const { kind } = get();
    if (!kind) {
      return;
    }
    if (fetchInFlight) {
      return fetchInFlight;
    }

    const branchId = get().branchId ?? getActiveBranchFilter() ?? undefined;
    set({ loading: true, error: null });

    fetchInFlight = (async () => {
      try {
        const agencyPromise = needsAgency(kind)
          ? getAgencyBootstrap(branchId).catch(() => null)
          : Promise.resolve(null);
        const withdrawalsPromise = needsWithdrawals(kind)
          ? getWithdrawalsBootstrap(branchId).then((data) => data.withdrawals).catch(() => [])
          : Promise.resolve([] as BalanceDisclosure[]);

        const [agency, withdrawals] = await Promise.all([agencyPromise, withdrawalsPromise]);
        set({
          agency,
          withdrawals,
          loading: false,
          lastFetchedAt: Date.now(),
          error: null
        });
      } catch (error) {
        set({
          loading: false,
          error: toUserFacingError(error, "Could not load workspace")
        });
      } finally {
        fetchInFlight = null;
      }
    })();

    return fetchInFlight;
  },

  refreshSilent: async () => {
    const { kind } = get();
    if (!kind || fetchInFlight) {
      return;
    }

    const branchId = get().branchId ?? getActiveBranchFilter() ?? undefined;
    fetchInFlight = (async () => {
      try {
        const agencyPromise = needsAgency(kind)
          ? getAgencyBootstrap(branchId).catch(() => null)
          : Promise.resolve(null);
        const withdrawalsPromise = needsWithdrawals(kind)
          ? getWithdrawalsBootstrap(branchId).then((data) => data.withdrawals).catch(() => [])
          : Promise.resolve([] as BalanceDisclosure[]);

        const [agency, withdrawals] = await Promise.all([agencyPromise, withdrawalsPromise]);
        set({ agency, withdrawals, lastFetchedAt: Date.now(), error: null });
      } catch {
        // Keep stale data on silent refresh failure
      } finally {
        fetchInFlight = null;
      }
    })();

    return fetchInFlight;
  },

  executeDeposit: async (transactionId) => {
    set({ busyId: transactionId, error: null });
    try {
      await executeAgencyBankDeposit(transactionId);
      await get().refresh();
    } catch (error) {
      set({ error: toUserFacingError(error, "Bank execution failed") });
      throw error;
    } finally {
      set({ busyId: null });
    }
  },

  payWithdrawal: async (disclosureId) => {
    set({ busyId: disclosureId, error: null });
    try {
      await tellerPayAgencyWithdrawal(disclosureId);
      await get().refreshSilent();
    } catch (error) {
      set({ error: toUserFacingError(error, "Cash payout failed") });
      throw error;
    } finally {
      set({ busyId: null });
    }
  },

  verifyWithdrawal: async (disclosureId, bankProductId, workflowData) => {
    set({ busyId: disclosureId, error: null });
    try {
      const approved = await approveBalanceDisclosure(disclosureId, {
        ...(bankProductId ? { bankProductId } : {}),
        ...(workflowData ? { workflowData } : {})
      });
      set((state) => ({
        withdrawals: state.withdrawals.map((row) => (row.id === approved.id ? approved : row))
      }));
      await get().refreshSilent();
      return approved;
    } catch (error) {
      set({ error: toUserFacingError(error, "Verification failed") });
      throw error;
    } finally {
      set({ busyId: null });
    }
  },

  declineWithdrawal: async (disclosureId, reason) => {
    set({ busyId: disclosureId, error: null });
    try {
      const rejected = await rejectBalanceDisclosure(disclosureId, reason);
      set((state) => ({
        withdrawals: state.withdrawals.map((row) => (row.id === rejected.id ? rejected : row))
      }));
      await get().refreshSilent();
      return rejected;
    } catch (error) {
      set({ error: toUserFacingError(error, "Decline failed") });
      throw error;
    } finally {
      set({ busyId: null });
    }
  },

  startLiveSync: () => {
    const tables = liveSyncTables(get().kind);
    if (!tables.length || get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables,
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt)
    });
  },

  stopLiveSync: () => {
    if (!get().liveSyncActive) {
      return;
    }
    liveSync.stop();
    set({ liveSyncActive: false });
  }
}));

export function selectCsQueueKpis(withdrawals: BalanceDisclosure[]) {
  const pending = withdrawals.filter((r) => r.status === "pending");
  const verified = withdrawals.filter((r) => r.status === "cs_approved" || r.status === "approved");
  const rejected = withdrawals.filter((r) => r.status === "rejected");
  const pendingAmount = pending.reduce((sum, r) => sum + (r.withdrawalAmount ?? 0), 0);
  return {
    pending: pending.length,
    verified: verified.length,
    rejected: rejected.length,
    pendingAmount
  };
}

export function formatWorkspaceMoney(value: number): string {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS" }).format(value);
}
