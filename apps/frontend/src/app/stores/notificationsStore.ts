import { create } from "zustand";
import type { AgentNotification } from "../api";
import { listAgentNotifications, markAgentNotificationRead } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import { isFieldAgentAlert } from "../../agent/agentAlertKinds";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";
import { getTenantId } from "../api";

type NotificationsState = {
  items: AgentNotification[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  liveSyncActive: boolean;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  startLiveSync: () => void;
  stopLiveSync: () => void;
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();
let fetchInFlight: Promise<void> | null = null;

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: [],
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
        const items = await listAgentNotifications();
        set({
          items,
          lastFetchedAt: Date.now(),
          error: null
        });
      } catch (error) {
        set({ error: toUserFacingError(error, "Failed to load notifications") });
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
        const previous = get().items;
        const items = await listAgentNotifications();
        set({
          items,
          lastFetchedAt: Date.now(),
          error: null
        });
        const prevIds = new Set(previous.map((n) => n.id));
        const floatChanged = items.some(
          (n) =>
            (n.kind === "float_allocated" ||
              n.kind === "float_requested" ||
              n.kind === "float_closed_pending_settlement") &&
            (!prevIds.has(n.id) || previous.find((p) => p.id === n.id)?.readAt !== n.readAt)
        );
        if (floatChanged) {
          void import("./branchCounterStore").then((mod) => {
            void mod.useBranchCounterStore.getState().refreshSilent();
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
      tables: ["agent_notifications"],
      onRefresh: () => void get().refreshSilent(),
      isStale: () => !isFresh(get().lastFetchedAt)
    });
  },

  stopLiveSync: () => {
    liveSync.stop();
    silentScheduler.clear();
    set({ liveSyncActive: false });
  },

  markRead: async (notificationId) => {
    const current = get().items.find((n) => n.id === notificationId);
    if (!current || current.readAt) {
      return;
    }
    const readAt = new Date().toISOString();
    set({
      items: get().items.map((n) => (n.id === notificationId ? { ...n, readAt } : n))
    });
    try {
      await markAgentNotificationRead(notificationId);
    } catch {
      set({
        items: get().items.map((n) =>
          n.id === notificationId ? { ...n, readAt: current.readAt } : n
        )
      });
    }
  },

  markAllRead: async () => {
    const unread = get().items.filter((n) => !n.readAt);
    if (unread.length === 0) {
      return;
    }
    const readAt = new Date().toISOString();
    set({
      items: get().items.map((n) => (n.readAt ? n : { ...n, readAt }))
    });
    await Promise.all(
      unread.map((n) =>
        markAgentNotificationRead(n.id).catch(() => {
          /* ignore individual failures */
        })
      )
    );
  }
}));

export function selectUnreadNotificationCount(state: NotificationsState): number {
  return state.items.filter((n) => !n.readAt).length;
}

export function selectUnreadFieldAgentNotificationCount(state: NotificationsState): number {
  return state.items.filter((n) => !n.readAt && isFieldAgentAlert(n.kind)).length;
}
