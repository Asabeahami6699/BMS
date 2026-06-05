import { create } from "zustand";
import type { Payslip, StaffPayrollSetupResponse } from "../api";
import {
  getPayrollBootstrap,
  getTenantId,
  runPayrollForPeriod,
  updateRolePayrollDefault,
  updateUserPayrollProfile
} from "../api";
import {
  parseMoney,
  parseOptionalPercent,
  recomputeStaffRowLive,
  recomputeStaffRowsForRole,
  roleDraftPayload,
  toRoleDraft,
  toStaffRow,
  type PayrollPolicy,
  type RoleDraft,
  type StaffRow
} from "../payrollRoleUtils";
import type { TenantPayrollRole } from "@bms/shared";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

type PayrollState = {
  period: StaffPayrollSetupResponse["period"] | null;
  policy: PayrollPolicy | null;
  roleDrafts: RoleDraft[];
  staffRows: StaffRow[];
  published: Payslip[];
  myPayslips: Payslip[];
  loading: boolean;
  refreshing: boolean;
  running: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;

  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;

  patchRoleDraft: (role: TenantPayrollRole, patch: Partial<RoleDraft>) => void;
  saveRoleDraft: (role: TenantPayrollRole) => Promise<void>;
  saveAllRoleDrafts: () => Promise<void>;

  patchStaffDraft: (userId: string, patch: Partial<StaffRow>) => void;
  saveStaffRow: (userId: string) => Promise<void>;

  runPayroll: () => Promise<number>;
};

let fetchInFlight: Promise<void> | null = null;

function applyBootstrap(payload: {
  period: StaffPayrollSetupResponse["period"];
  policy: PayrollPolicy;
  roleDefaults: StaffPayrollSetupResponse["roleDefaults"];
  rows: StaffPayrollSetupResponse["rows"];
  payslips: Payslip[];
  myPayslips: Payslip[];
}) {
  return {
    period: payload.period,
    policy: payload.policy,
    roleDrafts: payload.roleDefaults.map(toRoleDraft),
    staffRows: payload.rows.map(toStaffRow),
    published: payload.payslips,
    myPayslips: payload.myPayslips,
    lastFetchedAt: Date.now(),
    error: null
  };
}

function roleDraftByRole(roleDrafts: RoleDraft[], role: string): RoleDraft | undefined {
  return roleDrafts.find((d) => d.role === role);
}

export const usePayrollStore = create<PayrollState>((set, get) => ({
  period: null,
  policy: null,
  roleDrafts: [],
  staffRows: [],
  published: [],
  myPayslips: [],
  loading: false,
  refreshing: false,
  running: false,
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
      if (get().staffRows.length === 0) {
        set({ loading: true });
      } else {
        set({ refreshing: true });
      }
      await fetchInFlight;
      set({ loading: false, refreshing: false });
      return;
    }

    const showFullLoader = get().staffRows.length === 0;
    set({
      loading: showFullLoader,
      refreshing: !showFullLoader,
      error: null
    });

    fetchInFlight = (async () => {
      try {
        const data = await getPayrollBootstrap();
        set(applyBootstrap(data));
      } catch (error) {
        set({ error: toUserFacingError(error, "Failed to load payroll") });
      } finally {
        set({ loading: false, refreshing: false });
        fetchInFlight = null;
      }
    })();
    await fetchInFlight;
  },

  refreshSilent: async () => {
    if (fetchInFlight) {
      return fetchInFlight;
    }
    set({ refreshing: true });
    fetchInFlight = (async () => {
      try {
        const data = await getPayrollBootstrap();
        set(applyBootstrap(data));
      } catch {
        /* keep cached snapshot */
      } finally {
        set({ refreshing: false });
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  startLiveSync: () => {
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: [],
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt)
    });
  },

  stopLiveSync: () => {
    liveSync.stop();
    silentScheduler.clear();
    set({ liveSyncActive: false });
  },

  patchRoleDraft: (role, patch) => {
    const { roleDrafts, staffRows, policy } = get();
    if (!policy) {
      return;
    }
    const nextDrafts = roleDrafts.map((d) => (d.role === role ? { ...d, ...patch } : d));
    const updatedDraft = nextDrafts.find((d) => d.role === role);
    const nextStaff =
      updatedDraft != null
        ? recomputeStaffRowsForRole(staffRows, role, updatedDraft, policy)
        : staffRows;
    set({ roleDrafts: nextDrafts, staffRows: nextStaff });
  },

  saveRoleDraft: async (role) => {
    const draft = get().roleDrafts.find((d) => d.role === role);
    if (!draft) {
      return;
    }
    get().patchRoleDraft(role, { saving: true });
    try {
      await updateRolePayrollDefault(role, roleDraftPayload(draft));
      await get().refreshSilent();
    } finally {
      get().patchRoleDraft(role, { saving: false });
    }
  },

  saveAllRoleDrafts: async () => {
    const drafts = get().roleDrafts;
    set({
      roleDrafts: drafts.map((d) => ({ ...d, saving: true }))
    });
    try {
      await Promise.all(
        drafts.map((draft) => updateRolePayrollDefault(draft.role, roleDraftPayload(draft)))
      );
      await get().refreshSilent();
    } finally {
      set({
        roleDrafts: get().roleDrafts.map((d) => ({ ...d, saving: false }))
      });
    }
  },

  patchStaffDraft: (userId, patch) => {
    const { staffRows, roleDrafts, policy } = get();
    if (!policy) {
      return;
    }
    const nextStaff = staffRows.map((row) => {
      if (row.userId !== userId) {
        return row;
      }
      const merged = { ...row, ...patch };
      const roleDraft = roleDraftByRole(roleDrafts, row.role);
      return recomputeStaffRowLive(merged, roleDraft, policy);
    });
    set({ staffRows: nextStaff });
  },

  saveStaffRow: async (userId) => {
    const row = get().staffRows.find((r) => r.userId === userId);
    if (!row) {
      return;
    }
    get().patchStaffDraft(userId, { saving: true });
    try {
      await updateUserPayrollProfile(userId, {
        loanDeduction: parseMoney(row.draftLoan),
        commissionPercentOverride: row.commissionsApply
          ? parseOptionalPercent(row.draftCommissionOverride)
          : undefined
      });
      await get().refreshSilent();
    } finally {
      get().patchStaffDraft(userId, { saving: false });
    }
  },

  runPayroll: async () => {
    set({ running: true });
    try {
      const payslips = await runPayrollForPeriod();
      await get().refreshSilent();
      return payslips.length;
    } finally {
      set({ running: false });
    }
  }
}));

export function selectStaffCountByRole(staffRows: StaffRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of staffRows) {
    if (row.status === "inactive") continue;
    counts[row.role] = (counts[row.role] ?? 0) + 1;
  }
  return counts;
}

export function selectStaffTotals(staffRows: StaffRow[]) {
  return staffRows.reduce(
    (acc, row) => ({
      gross: acc.gross + row.projectedGross,
      deductions: acc.deductions + row.projectedDeductions,
      net: acc.net + row.projectedNet
    }),
    { gross: 0, deductions: 0, net: 0 }
  );
}

export function selectPublishedTotals(published: Payslip[]) {
  return published.reduce(
    (acc, p) => ({
      gross: acc.gross + p.grossPay,
      deductions: acc.deductions + p.totalDeductions,
      net: acc.net + p.netPay
    }),
    { gross: 0, deductions: 0, net: 0 }
  );
}
