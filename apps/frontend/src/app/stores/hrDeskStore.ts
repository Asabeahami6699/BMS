import { create } from "zustand";
import type { HrAttendanceRecord, HrLeaveRequest, HrTrainingRecord } from "@bms/shared";
import type { UserRecord } from "../api";
import type { HrPolicies, HrStaffLoan } from "@bms/shared";
import {
  createHrLeaveRequest,
  createHrTraining,
  getTenantId,
  listHrAttendance,
  listHrLeaveRequests,
  getHrPolicies,
  listHrStaffLoans,
  listHrTraining,
  listUsers,
  updateHrLeaveStatus,
  updateHrPolicies,
  updateHrStaffLoanStatus,
  upsertHrAttendance
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

const DESK_STALE_MS = 30_000;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

type StaffOption = { userId: string; label: string };

function toStaffOptions(users: UserRecord[]): StaffOption[] {
  return users.map((u) => ({
    userId: u.userId,
    label: u.fullName ? `${u.fullName} (${u.email})` : u.email
  }));
}

type State = {
  users: UserRecord[];
  leaveRequests: HrLeaveRequest[];
  attendanceRows: HrAttendanceRecord[];
  attendanceDate: string;
  attendanceDateFrom: string;
  attendanceDateTo: string;
  trainingRows: HrTrainingRecord[];
  rosterLoading: boolean;
  leaveLoading: boolean;
  attendanceLoading: boolean;
  trainingLoading: boolean;
  rosterError: string | null;
  leaveError: string | null;
  attendanceError: string | null;
  trainingError: string | null;
  lastRosterAt: number | null;
  lastLeaveAt: number | null;
  lastAttendanceAt: number | null;
  lastAttendanceDate: string | null;
  lastTrainingAt: number | null;
  staffLoans: HrStaffLoan[];
  staffLoansLoading: boolean;
  staffLoansError: string | null;
  lastStaffLoansAt: number | null;
  liveSyncActive: boolean;

  staffOptions: () => StaffOption[];
  hydrateRoster: (options?: { force?: boolean }) => void;
  refreshRoster: () => Promise<void>;
  refreshRosterSilent: () => Promise<void>;
  hydrateLeave: (options?: { force?: boolean }) => void;
  refreshLeave: () => Promise<void>;
  refreshLeaveSilent: () => Promise<void>;
  submitLeave: (payload: {
    userId: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    notes?: string;
  }) => Promise<void>;
  setLeaveStatus: (
    requestId: string,
    status: "approved" | "rejected",
    options?: { rejectedReason?: string }
  ) => Promise<void>;
  hydrateStaffLoans: (options?: { force?: boolean }) => void;
  refreshStaffLoans: () => Promise<void>;
  setStaffLoanStatus: (
    loanId: string,
    status: "approved" | "declined",
    options?: { monthlyDeduction?: number }
  ) => Promise<void>;
  policies: HrPolicies | null;
  policiesLoading: boolean;
  policiesError: string | null;
  lastPoliciesAt: number | null;
  hydratePolicies: (options?: { force?: boolean }) => void;
  refreshPolicies: () => Promise<void>;
  savePolicies: (payload: HrPolicies) => Promise<void>;
  setAttendanceDate: (date: string) => void;
  setAttendanceDateRange: (dateFrom: string, dateTo: string) => void;
  hydrateAttendance: (options?: { force?: boolean }) => void;
  refreshAttendance: () => Promise<void>;
  refreshAttendanceSilent: () => Promise<void>;
  saveAttendance: (payload: {
    userId: string;
    businessDate: string;
    status: HrAttendanceRecord["status"];
  }) => Promise<void>;
  hydrateTraining: (options?: { force?: boolean }) => void;
  refreshTraining: () => Promise<void>;
  refreshTrainingSilent: () => Promise<void>;
  addTraining: (payload: {
    userId: string;
    trainingTitle: string;
    expiresOn?: string;
  }) => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let rosterFetch: Promise<void> | null = null;
let leaveFetch: Promise<void> | null = null;
let attendanceFetch: Promise<void> | null = null;
let trainingFetch: Promise<void> | null = null;
let staffLoansFetch: Promise<void> | null = null;
let policiesFetch: Promise<void> | null = null;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function isDeskFresh(at: number | null): boolean {
  return isFresh(at, DESK_STALE_MS);
}

async function ensureRosterLoaded(get: () => State): Promise<UserRecord[]> {
  const state = get();
  if (state.users.length > 0 && isDeskFresh(state.lastRosterAt)) {
    return state.users;
  }
  await get().refreshRoster();
  return get().users;
}

export const useHrDeskStore = create<State>((set, get) => ({
  users: [],
  leaveRequests: [],
  attendanceRows: [],
  attendanceDate: todayIso(),
  attendanceDateFrom: daysAgoIso(30),
  attendanceDateTo: todayIso(),
  trainingRows: [],
  rosterLoading: false,
  leaveLoading: false,
  attendanceLoading: false,
  trainingLoading: false,
  rosterError: null,
  leaveError: null,
  attendanceError: null,
  trainingError: null,
  lastRosterAt: null,
  lastLeaveAt: null,
  lastAttendanceAt: null,
  lastAttendanceDate: null,
  lastTrainingAt: null,
  staffLoans: [],
  staffLoansLoading: false,
  staffLoansError: null,
  lastStaffLoansAt: null,
  policies: null,
  policiesLoading: false,
  policiesError: null,
  lastPoliciesAt: null,
  liveSyncActive: false,

  staffOptions: () => toStaffOptions(get().users),

  hydrateRoster: (options) => {
    const { rosterLoading, lastRosterAt } = get();
    runHydrate({
      force: options?.force,
      loading: rosterLoading,
      lastFetchedAt: lastRosterAt,
      refresh: () => get().refreshRoster(),
      refreshSilent: () => get().refreshRosterSilent(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
  },

  refreshRoster: async () => {
    if (rosterFetch) {
      return rosterFetch;
    }
    set({ rosterLoading: true, rosterError: null });
    rosterFetch = (async () => {
      try {
        const users = await listUsers();
        set({ users, lastRosterAt: Date.now(), rosterError: null });
      } catch (error) {
        set({ rosterError: toUserFacingError(error, "Could not load staff roster") });
      } finally {
        set({ rosterLoading: false });
        rosterFetch = null;
      }
    })();
    return rosterFetch;
  },

  refreshRosterSilent: async () => {
    if (rosterFetch) {
      return rosterFetch;
    }
    rosterFetch = (async () => {
      try {
        const users = await listUsers();
        set({ users, lastRosterAt: Date.now(), rosterError: null });
      } catch {
        /* keep stale */
      } finally {
        rosterFetch = null;
      }
    })();
    return rosterFetch;
  },

  hydrateLeave: (options) => {
    const { leaveLoading, lastLeaveAt } = get();
    runHydrate({
      force: options?.force,
      loading: leaveLoading,
      lastFetchedAt: lastLeaveAt,
      refresh: () => get().refreshLeave(),
      refreshSilent: () => get().refreshLeaveSilent(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
    if (!get().users.length) {
      get().hydrateRoster();
    }
  },

  refreshLeave: async () => {
    if (leaveFetch) {
      return leaveFetch;
    }
    set({ leaveLoading: true, leaveError: null });
    leaveFetch = (async () => {
      try {
        await ensureRosterLoaded(get);
        const leaveRequests = await listHrLeaveRequests();
        set({ leaveRequests, lastLeaveAt: Date.now(), leaveError: null });
      } catch (error) {
        set({ leaveError: toUserFacingError(error, "Could not load leave requests") });
      } finally {
        set({ leaveLoading: false });
        leaveFetch = null;
      }
    })();
    return leaveFetch;
  },

  refreshLeaveSilent: async () => {
    if (leaveFetch) {
      return leaveFetch;
    }
    leaveFetch = (async () => {
      try {
        const leaveRequests = await listHrLeaveRequests();
        set({ leaveRequests, lastLeaveAt: Date.now(), leaveError: null });
      } catch {
        /* keep stale */
      } finally {
        leaveFetch = null;
      }
    })();
    return leaveFetch;
  },

  submitLeave: async (payload) => {
    await createHrLeaveRequest(payload);
    set({ lastLeaveAt: null });
    await get().refreshLeave();
  },

  setLeaveStatus: async (requestId, status, options) => {
    await updateHrLeaveStatus(requestId, status, { rejectedReason: options?.rejectedReason });
    set({ lastLeaveAt: null, lastAttendanceAt: null });
    await get().refreshLeave();
    if (status === "approved") {
      await get().refreshAttendance();
    }
  },

  hydrateStaffLoans: (options) => {
    const { staffLoansLoading, lastStaffLoansAt } = get();
    runHydrate({
      force: options?.force,
      loading: staffLoansLoading,
      lastFetchedAt: lastStaffLoansAt,
      refresh: () => get().refreshStaffLoans(),
      refreshSilent: () => get().refreshStaffLoans(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
  },

  refreshStaffLoans: async () => {
    if (staffLoansFetch) {
      return staffLoansFetch;
    }
    set({ staffLoansLoading: true, staffLoansError: null });
    staffLoansFetch = (async () => {
      try {
        const staffLoans = await listHrStaffLoans();
        set({ staffLoans, lastStaffLoansAt: Date.now(), staffLoansError: null });
      } catch (error) {
        set({ staffLoansError: toUserFacingError(error, "Could not load staff loans") });
      } finally {
        set({ staffLoansLoading: false });
        staffLoansFetch = null;
      }
    })();
    return staffLoansFetch;
  },

  setStaffLoanStatus: async (loanId, status, options) => {
    await updateHrStaffLoanStatus(loanId, status, { monthlyDeduction: options?.monthlyDeduction });
    set({ lastStaffLoansAt: null });
    await get().refreshStaffLoans();
  },

  hydratePolicies: (options) => {
    const { policiesLoading, lastPoliciesAt } = get();
    runHydrate({
      force: options?.force,
      loading: policiesLoading,
      lastFetchedAt: lastPoliciesAt,
      refresh: () => get().refreshPolicies(),
      refreshSilent: () => get().refreshPolicies(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
  },

  refreshPolicies: async () => {
    if (policiesFetch) {
      return policiesFetch;
    }
    set({ policiesLoading: true, policiesError: null });
    policiesFetch = (async () => {
      try {
        const policies = await getHrPolicies();
        set({ policies, lastPoliciesAt: Date.now(), policiesError: null });
      } catch (error) {
        set({ policiesError: toUserFacingError(error, "Could not load HR policies") });
      } finally {
        set({ policiesLoading: false });
        policiesFetch = null;
      }
    })();
    return policiesFetch;
  },

  savePolicies: async (payload) => {
    const policies = await updateHrPolicies(payload);
    set({ policies, lastPoliciesAt: Date.now(), policiesError: null });
  },

  setAttendanceDate: (date) => {
    if (get().attendanceDate === date) {
      return;
    }
    set({ attendanceDate: date });
  },

  setAttendanceDateRange: (dateFrom, dateTo) => {
    const state = get();
    if (state.attendanceDateFrom === dateFrom && state.attendanceDateTo === dateTo) {
      return;
    }
    set({ attendanceDateFrom: dateFrom, attendanceDateTo: dateTo, lastAttendanceAt: null });
    get().hydrateAttendance({ force: true });
  },

  hydrateAttendance: (options) => {
    const { attendanceLoading, lastAttendanceAt, attendanceDateFrom, attendanceDateTo, lastAttendanceDate } =
      get();
    const rangeKey = `${attendanceDateFrom}:${attendanceDateTo}`;
    const dateChanged = lastAttendanceDate !== null && lastAttendanceDate !== rangeKey;
    const effectiveLast = dateChanged ? null : lastAttendanceAt;
    runHydrate({
      force: options?.force || dateChanged,
      loading: attendanceLoading,
      lastFetchedAt: effectiveLast,
      refresh: () => get().refreshAttendance(),
      refreshSilent: () => get().refreshAttendanceSilent(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
    if (!get().users.length) {
      get().hydrateRoster();
    }
  },

  refreshAttendance: async () => {
    if (attendanceFetch) {
      return attendanceFetch;
    }
    const { attendanceDateFrom, attendanceDateTo } = get();
    set({ attendanceLoading: true, attendanceError: null });
    attendanceFetch = (async () => {
      try {
        await ensureRosterLoaded(get);
        const attendanceRows = await listHrAttendance({
          dateFrom: attendanceDateFrom,
          dateTo: attendanceDateTo
        });
        set({
          attendanceRows,
          lastAttendanceAt: Date.now(),
          lastAttendanceDate: `${attendanceDateFrom}:${attendanceDateTo}`,
          attendanceError: null
        });
      } catch (error) {
        set({ attendanceError: toUserFacingError(error, "Could not load attendance") });
      } finally {
        set({ attendanceLoading: false });
        attendanceFetch = null;
      }
    })();
    return attendanceFetch;
  },

  refreshAttendanceSilent: async () => {
    if (attendanceFetch) {
      return attendanceFetch;
    }
    const { attendanceDateFrom, attendanceDateTo } = get();
    attendanceFetch = (async () => {
      try {
        const attendanceRows = await listHrAttendance({
          dateFrom: attendanceDateFrom,
          dateTo: attendanceDateTo
        });
        set({
          attendanceRows,
          lastAttendanceAt: Date.now(),
          lastAttendanceDate: `${attendanceDateFrom}:${attendanceDateTo}`,
          attendanceError: null
        });
      } catch {
        /* keep stale */
      } finally {
        attendanceFetch = null;
      }
    })();
    return attendanceFetch;
  },

  saveAttendance: async (payload) => {
    await upsertHrAttendance(payload);
    set({ lastAttendanceAt: null });
    await get().refreshAttendance();
  },

  hydrateTraining: (options) => {
    const { trainingLoading, lastTrainingAt } = get();
    runHydrate({
      force: options?.force,
      loading: trainingLoading,
      lastFetchedAt: lastTrainingAt,
      refresh: () => get().refreshTraining(),
      refreshSilent: () => get().refreshTrainingSilent(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
    if (!get().users.length) {
      get().hydrateRoster();
    }
  },

  refreshTraining: async () => {
    if (trainingFetch) {
      return trainingFetch;
    }
    set({ trainingLoading: true, trainingError: null });
    trainingFetch = (async () => {
      try {
        await ensureRosterLoaded(get);
        const trainingRows = await listHrTraining();
        set({ trainingRows, lastTrainingAt: Date.now(), trainingError: null });
      } catch (error) {
        set({ trainingError: toUserFacingError(error, "Could not load training records") });
      } finally {
        set({ trainingLoading: false });
        trainingFetch = null;
      }
    })();
    return trainingFetch;
  },

  refreshTrainingSilent: async () => {
    if (trainingFetch) {
      return trainingFetch;
    }
    trainingFetch = (async () => {
      try {
        const trainingRows = await listHrTraining();
        set({ trainingRows, lastTrainingAt: Date.now(), trainingError: null });
      } catch {
        /* keep stale */
      } finally {
        trainingFetch = null;
      }
    })();
    return trainingFetch;
  },

  addTraining: async (payload) => {
    await createHrTraining({ ...payload, status: "due" });
    set({ lastTrainingAt: null });
    await get().refreshTraining();
  },

  startLiveSync: () => {
    if (get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: [
        "users",
        "hr_leave_requests",
        "hr_attendance_records",
        "hr_training_records",
        "hr_staff_loans"
      ],
      onRefresh: () => {
        void get().refreshRosterSilent();
        void get().refreshLeaveSilent();
        void get().refreshAttendanceSilent();
        void get().refreshTrainingSilent();
        void get().refreshStaffLoans();
      },
      isStale: () => !isDeskFresh(get().lastRosterAt)
    });
  },

  stopLiveSync: () => {
    if (!get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: false });
    liveSync.stop();
  }
}));
