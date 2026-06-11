import { create } from "zustand";
import type {
  CompanyAnnouncement,
  CompanyDocument,
  HrAttendanceRecord,
  HrLeaveRequest,
  HrLeaveSummary,
  HrStaffLoan,
  IncidentReport,
  UniversalOpsSummary
} from "@bms/shared";
import {
  acknowledgeOpsAnnouncement,
  applyStaffLoan,
  checkInAttendance,
  checkOutAttendance,
  createOpsAnnouncement,
  getMyAttendanceToday,
  getMyLeaveSummary,
  getOpsSummary,
  getTenantId,
  listMyAttendanceHistory,
  listMyIncidents,
  listMyLeaveRequests,
  listMyStaffLoans,
  listOpsAnnouncements,
  listOpsDocuments,
  reportIncident,
  submitMyLeaveRequest,
  uploadOpsDocument
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

const STALE_MS = 30_000;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

type State = {
  summary: UniversalOpsSummary | null;
  todayAttendance: HrAttendanceRecord | null;
  attendanceHistory: HrAttendanceRecord[];
  leaveRequests: HrLeaveRequest[];
  leaveSummary: HrLeaveSummary | null;
  staffLoans: HrStaffLoan[];
  announcements: CompanyAnnouncement[];
  documents: CompanyDocument[];
  incidents: IncidentReport[];
  summaryLoading: boolean;
  attendanceLoading: boolean;
  leaveLoading: boolean;
  loansLoading: boolean;
  announcementsLoading: boolean;
  documentsLoading: boolean;
  incidentsLoading: boolean;
  actionBusy: boolean;
  error: string | null;
  lastSummaryAt: number | null;
  lastAttendanceAt: number | null;
  lastLeaveAt: number | null;
  lastLoansAt: number | null;
  lastAnnouncementsAt: number | null;
  lastDocumentsAt: number | null;
  lastIncidentsAt: number | null;
  liveSyncActive: boolean;

  hydrateAll: (options?: { force?: boolean }) => void;
  refreshSummary: () => Promise<void>;
  refreshAttendance: () => Promise<void>;
  refreshLeave: () => Promise<void>;
  refreshLoans: () => Promise<void>;
  refreshAnnouncements: () => Promise<void>;
  refreshDocuments: () => Promise<void>;
  refreshIncidents: () => Promise<void>;
  checkIn: (photoUrl?: string) => Promise<void>;
  checkOut: (photoUrl?: string) => Promise<void>;
  submitLeave: (payload: {
    leaveType: string;
    startDate: string;
    endDate: string;
    notes?: string;
  }) => Promise<void>;
  applyLoan: (payload: {
    amount: number;
    purpose: string;
    termMonths: number;
    notes?: string;
  }) => Promise<void>;
  acknowledgeAnnouncement: (id: string) => Promise<void>;
  publishAnnouncement: (payload: {
    title: string;
    body: string;
    category: string;
    pinned?: boolean;
  }) => Promise<void>;
  uploadDocument: (payload: {
    title: string;
    category: string;
    fileUrl?: string;
    version?: string;
  }) => Promise<void>;
  submitIncident: (payload: { incidentType: string; description: string }) => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

let summaryFetch: Promise<void> | null = null;
let attendanceFetch: Promise<void> | null = null;
let leaveFetch: Promise<void> | null = null;
let loansFetch: Promise<void> | null = null;
let announcementsFetch: Promise<void> | null = null;
let documentsFetch: Promise<void> | null = null;
let incidentsFetch: Promise<void> | null = null;

async function silentRefreshAll(get: () => State): Promise<void> {
  await Promise.all([
    get().refreshSummary(),
    get().refreshAttendance(),
    get().refreshLeave(),
    get().refreshLoans(),
    get().refreshAnnouncements(),
    get().refreshDocuments(),
    get().refreshIncidents()
  ]);
}

export const useUniversalOpsStore = create<State>((set, get) => ({
  summary: null,
  todayAttendance: null,
  attendanceHistory: [],
  leaveRequests: [],
  leaveSummary: null,
  staffLoans: [],
  announcements: [],
  documents: [],
  incidents: [],
  summaryLoading: false,
  attendanceLoading: false,
  leaveLoading: false,
  loansLoading: false,
  announcementsLoading: false,
  documentsLoading: false,
  incidentsLoading: false,
  actionBusy: false,
  error: null,
  lastSummaryAt: null,
  lastAttendanceAt: null,
  lastLeaveAt: null,
  lastLoansAt: null,
  lastAnnouncementsAt: null,
  lastDocumentsAt: null,
  lastIncidentsAt: null,
  liveSyncActive: false,

  hydrateAll: (options) => {
    const state = get();
    runHydrate({
      force: options?.force,
      loading: state.summaryLoading,
      lastFetchedAt: state.lastSummaryAt,
      refresh: () => get().refreshSummary(),
      refreshSilent: () => get().refreshSummary(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
    runHydrate({
      force: options?.force,
      loading: state.attendanceLoading,
      lastFetchedAt: state.lastAttendanceAt,
      refresh: () => get().refreshAttendance(),
      refreshSilent: () => get().refreshAttendance(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
    runHydrate({
      force: options?.force,
      loading: state.leaveLoading,
      lastFetchedAt: state.lastLeaveAt,
      refresh: () => get().refreshLeave(),
      refreshSilent: () => get().refreshLeave(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
    runHydrate({
      force: options?.force,
      loading: state.loansLoading,
      lastFetchedAt: state.lastLoansAt,
      refresh: () => get().refreshLoans(),
      refreshSilent: () => get().refreshLoans(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
    runHydrate({
      force: options?.force,
      loading: state.announcementsLoading,
      lastFetchedAt: state.lastAnnouncementsAt,
      refresh: () => get().refreshAnnouncements(),
      refreshSilent: () => get().refreshAnnouncements(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
    runHydrate({
      force: options?.force,
      loading: state.documentsLoading,
      lastFetchedAt: state.lastDocumentsAt,
      refresh: () => get().refreshDocuments(),
      refreshSilent: () => get().refreshDocuments(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
    runHydrate({
      force: options?.force,
      loading: state.incidentsLoading,
      lastFetchedAt: state.lastIncidentsAt,
      refresh: () => get().refreshIncidents(),
      refreshSilent: () => get().refreshIncidents(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
  },

  refreshSummary: async () => {
    if (summaryFetch) {
      return summaryFetch;
    }
    set({ summaryLoading: true, error: null });
    summaryFetch = (async () => {
      try {
        const summary = await getOpsSummary();
        set({ summary, lastSummaryAt: Date.now(), error: null });
      } catch (error) {
        set({ error: toUserFacingError(error, "Could not load summary") });
      } finally {
        set({ summaryLoading: false });
        summaryFetch = null;
      }
    })();
    return summaryFetch;
  },

  refreshAttendance: async () => {
    if (attendanceFetch) {
      return attendanceFetch;
    }
    set({ attendanceLoading: true });
    attendanceFetch = (async () => {
      try {
        const [todayAttendance, attendanceHistory] = await Promise.all([
          getMyAttendanceToday(),
          listMyAttendanceHistory()
        ]);
        set({
          todayAttendance,
          attendanceHistory,
          lastAttendanceAt: Date.now()
        });
      } catch (error) {
        set({ error: toUserFacingError(error, "Could not load attendance") });
      } finally {
        set({ attendanceLoading: false });
        attendanceFetch = null;
      }
    })();
    return attendanceFetch;
  },

  refreshLeave: async () => {
    if (leaveFetch) {
      return leaveFetch;
    }
    set({ leaveLoading: true });
    leaveFetch = (async () => {
      try {
        const [leaveRequests, leaveSummary] = await Promise.all([
          listMyLeaveRequests(),
          getMyLeaveSummary()
        ]);
        set({ leaveRequests, leaveSummary, lastLeaveAt: Date.now() });
      } catch (error) {
        set({ error: toUserFacingError(error, "Could not load leave") });
      } finally {
        set({ leaveLoading: false });
        leaveFetch = null;
      }
    })();
    return leaveFetch;
  },

  refreshLoans: async () => {
    if (loansFetch) {
      return loansFetch;
    }
    set({ loansLoading: true });
    loansFetch = (async () => {
      try {
        const staffLoans = await listMyStaffLoans();
        set({ staffLoans, lastLoansAt: Date.now() });
      } catch (error) {
        set({ error: toUserFacingError(error, "Could not load loans") });
      } finally {
        set({ loansLoading: false });
        loansFetch = null;
      }
    })();
    return loansFetch;
  },

  refreshAnnouncements: async () => {
    if (announcementsFetch) {
      return announcementsFetch;
    }
    set({ announcementsLoading: true });
    announcementsFetch = (async () => {
      try {
        const announcements = await listOpsAnnouncements();
        set({ announcements, lastAnnouncementsAt: Date.now() });
      } catch (error) {
        set({ error: toUserFacingError(error, "Could not load announcements") });
      } finally {
        set({ announcementsLoading: false });
        announcementsFetch = null;
      }
    })();
    return announcementsFetch;
  },

  refreshDocuments: async () => {
    if (documentsFetch) {
      return documentsFetch;
    }
    set({ documentsLoading: true });
    documentsFetch = (async () => {
      try {
        const documents = await listOpsDocuments();
        set({ documents, lastDocumentsAt: Date.now() });
      } catch (error) {
        set({ error: toUserFacingError(error, "Could not load documents") });
      } finally {
        set({ documentsLoading: false });
        documentsFetch = null;
      }
    })();
    return documentsFetch;
  },

  refreshIncidents: async () => {
    if (incidentsFetch) {
      return incidentsFetch;
    }
    set({ incidentsLoading: true });
    incidentsFetch = (async () => {
      try {
        const incidents = await listMyIncidents();
        set({ incidents, lastIncidentsAt: Date.now() });
      } catch (error) {
        set({ error: toUserFacingError(error, "Could not load incidents") });
      } finally {
        set({ incidentsLoading: false });
        incidentsFetch = null;
      }
    })();
    return incidentsFetch;
  },

  checkIn: async (photoUrl) => {
    set({ actionBusy: true });
    try {
      const todayAttendance = await checkInAttendance({ photoUrl });
      set({ todayAttendance, lastAttendanceAt: null });
      await get().refreshAttendance();
      await get().refreshSummary();
    } finally {
      set({ actionBusy: false });
    }
  },

  checkOut: async (photoUrl) => {
    set({ actionBusy: true });
    try {
      const todayAttendance = await checkOutAttendance({ photoUrl });
      set({ todayAttendance, lastAttendanceAt: null });
      await get().refreshAttendance();
      await get().refreshSummary();
    } finally {
      set({ actionBusy: false });
    }
  },

  submitLeave: async (payload) => {
    set({ actionBusy: true });
    try {
      await submitMyLeaveRequest(payload);
      set({ lastLeaveAt: null });
      await get().refreshLeave();
      await get().refreshSummary();
    } finally {
      set({ actionBusy: false });
    }
  },

  applyLoan: async (payload) => {
    set({ actionBusy: true });
    try {
      await applyStaffLoan(payload);
      set({ lastLoansAt: null });
      await get().refreshLoans();
      await get().refreshSummary();
    } finally {
      set({ actionBusy: false });
    }
  },

  acknowledgeAnnouncement: async (id) => {
    await acknowledgeOpsAnnouncement(id);
    set({ lastAnnouncementsAt: null });
    await get().refreshAnnouncements();
    await get().refreshSummary();
  },

  publishAnnouncement: async (payload) => {
    set({ actionBusy: true });
    try {
      await createOpsAnnouncement(payload);
      set({ lastAnnouncementsAt: null });
      await get().refreshAnnouncements();
    } finally {
      set({ actionBusy: false });
    }
  },

  uploadDocument: async (payload) => {
    set({ actionBusy: true });
    try {
      await uploadOpsDocument(payload);
      set({ lastDocumentsAt: null });
      await get().refreshDocuments();
    } finally {
      set({ actionBusy: false });
    }
  },

  submitIncident: async (payload) => {
    set({ actionBusy: true });
    try {
      await reportIncident(payload);
      set({ lastIncidentsAt: null });
      await get().refreshIncidents();
      await get().refreshSummary();
    } finally {
      set({ actionBusy: false });
    }
  },

  startLiveSync: () => {
    if (get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: [
        "hr_attendance_records",
        "hr_leave_requests",
        "hr_staff_loans",
        "company_announcements",
        "company_documents",
        "incident_reports"
      ],
      onRefresh: () => {
        void silentRefreshAll(get);
      },
      isStale: () => !isFresh(get().lastSummaryAt, STALE_MS)
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
