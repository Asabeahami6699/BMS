import { create } from "zustand";
import type { Branch, BranchFloatSession, UserRecord } from "../api";
import {
  allocateBranchFloat,
  approveBranchFloatExpense,
  approveBranchFloatExtraCash,
  getTenantId,
  isFloatTopUpRequest,
  listBranchFloatSessions,
  listPendingBranchFloats,
  pendingFloatAmount,
  pushBranchFloat,
  settleBranchFloat
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";
import { useBranchCounterStore } from "./branchCounterStore";
import { useBranchesStore } from "./branchesStore";
import { useUsersStore } from "./usersStore";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type TillFloatAdminState = {
  pending: BranchFloatSession[];
  todaySessions: BranchFloatSession[];
  branches: Branch[];
  users: UserRecord[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;
  allocateAmount: Record<string, string>;
  allocateInitialCash: Record<string, string>;
  pushOpen: boolean;
  pushBranchId: string;
  pushUserId: string;
  pushAmount: string;
  pushInitialCash: string;

  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;

  setAllocateAmount: (sessionId: string, value: string) => void;
  setAllocateInitialCash: (sessionId: string, value: string) => void;
  openPushModal: () => void;
  closePushModal: () => void;
  setPushBranchId: (value: string) => void;
  setPushUserId: (value: string) => void;
  setPushAmount: (value: string) => void;
  setPushInitialCash: (value: string) => void;

  allocate: (session: BranchFloatSession) => Promise<void>;
  push: () => Promise<void>;
  settle: (session: BranchFloatSession) => Promise<void>;
  approveExtraCash: (session: BranchFloatSession) => Promise<void>;
  approveExpense: (session: BranchFloatSession) => Promise<void>;
};

let fetchInFlight: Promise<void> | null = null;
const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();

export const useTillFloatAdminStore = create<TillFloatAdminState>((set, get) => ({
  pending: [],
  todaySessions: [],
  branches: [],
  users: [],
  loading: false,
  busy: false,
  error: null,
  lastFetchedAt: null,
  liveSyncActive: false,
  allocateAmount: {},
  allocateInitialCash: {},
  pushOpen: false,
  pushBranchId: "",
  pushUserId: "",
  pushAmount: "500",
  pushInitialCash: "0",

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
        const [pendingRows, sessions] = await Promise.all([
          listPendingBranchFloats(),
          listBranchFloatSessions({ date: todayIso() }),
          useBranchesStore.getState().refresh(),
          useUsersStore.getState().refresh()
        ]);
        const activeBranches = useBranchesStore
          .getState()
          .branches.filter((b) => b.status !== "inactive");
        const userRows = useUsersStore.getState().users;
        set((state) => ({
          pending: pendingRows,
          todaySessions: sessions,
          branches: activeBranches,
          users: userRows,
          pushBranchId: state.pushBranchId || activeBranches[0]?.id || "",
          loading: false,
          lastFetchedAt: Date.now(),
          error: null
        }));
      } catch (error) {
        set({
          loading: false,
          error: toUserFacingError(error, "Failed to load till float data")
        });
      } finally {
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
        const [pendingRows, sessions] = await Promise.all([
          listPendingBranchFloats(),
          listBranchFloatSessions({ date: todayIso() })
        ]);
        set({
          pending: pendingRows,
          todaySessions: sessions,
          lastFetchedAt: Date.now(),
          error: null
        });
      } catch {
        /* keep cache */
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  startLiveSync: () => {
    if (get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: ["branch_float_sessions", "branch_float_movements", "agent_notifications"],
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt)
    });
  },

  stopLiveSync: () => {
    liveSync.stop();
    silentScheduler.clear();
    set({ liveSyncActive: false });
  },

  setAllocateAmount: (sessionId, value) =>
    set((s) => ({ allocateAmount: { ...s.allocateAmount, [sessionId]: value } })),
  setAllocateInitialCash: (sessionId, value) =>
    set((s) => ({ allocateInitialCash: { ...s.allocateInitialCash, [sessionId]: value } })),

  openPushModal: () =>
    set((s) => ({
      pushOpen: true,
      pushAmount: "500",
      pushInitialCash: "0",
      pushUserId: "",
      pushBranchId: s.pushBranchId || s.branches[0]?.id || ""
    })),
  closePushModal: () => set({ pushOpen: false }),
  setPushBranchId: (value) => set({ pushBranchId: value, pushUserId: "" }),
  setPushUserId: (value) => set({ pushUserId: value }),
  setPushAmount: (value) => set({ pushAmount: value }),
  setPushInitialCash: (value) => set({ pushInitialCash: value }),

  allocate: async (session) => {
    const amount = Number(get().allocateAmount[session.id] ?? pendingFloatAmount(session));
    const initialCash = Number(get().allocateInitialCash[session.id] ?? "0");
    set({ busy: true, error: null });
    try {
      await allocateBranchFloat(
        session.id,
        amount,
        isFloatTopUpRequest(session) ? undefined : initialCash
      );
      await get().refreshSilent();
      void useBranchCounterStore.getState().refreshSilent();
    } catch (error) {
      const message = toUserFacingError(error, "Could not release float");
      set({ error: message });
      throw new Error(message);
    } finally {
      set({ busy: false });
    }
  },

  push: async () => {
    const { pushBranchId, pushUserId, pushAmount, pushInitialCash } = get();
    if (!pushBranchId || !pushUserId) {
      throw new Error("Select branch and teller");
    }
    set({ busy: true, error: null });
    try {
      await pushBranchFloat({
        branchId: pushBranchId,
        cashierUserId: pushUserId,
        openingFloat: Number(pushAmount),
        initialCash: Number(pushInitialCash)
      });
      set({ pushOpen: false });
      await get().refreshSilent();
      void useBranchCounterStore.getState().refreshSilent();
    } catch (error) {
      const message = toUserFacingError(error, "Failed to push float");
      set({ error: message });
      throw new Error(message);
    } finally {
      set({ busy: false });
    }
  },

  settle: async (session) => {
    set({ busy: true, error: null });
    try {
      await settleBranchFloat(session.id);
      await get().refreshSilent();
    } catch (error) {
      const message = toUserFacingError(error, "Failed to settle");
      set({ error: message });
      throw new Error(message);
    } finally {
      set({ busy: false });
    }
  },

  approveExtraCash: async (session) => {
    set({ busy: true, error: null });
    try {
      await approveBranchFloatExtraCash(session.id);
      await get().refreshSilent();
      void useBranchCounterStore.getState().refreshSilent();
    } catch (error) {
      const message = toUserFacingError(error, "Could not approve extra cash");
      set({ error: message });
      throw new Error(message);
    } finally {
      set({ busy: false });
    }
  },

  approveExpense: async (session) => {
    set({ busy: true, error: null });
    try {
      await approveBranchFloatExpense(session.id);
      await get().refreshSilent();
      void useBranchCounterStore.getState().refreshSilent();
    } catch (error) {
      const message = toUserFacingError(error, "Could not approve expense");
      set({ error: message });
      throw new Error(message);
    } finally {
      set({ busy: false });
    }
  }
}));
