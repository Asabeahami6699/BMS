import { create } from "zustand";
import type { AuditLogRecord } from "../api";
import { getTenantId, listAuditLogs } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

const AUDIT_LOG_LIMIT = 200;

type AuditLogsState = {
  rows: AuditLogRecord[];
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

function rowsSnapshotKey(rows: AuditLogRecord[]): string {
  return rows.map((r) => `${r.id}:${r.createdAt}`).join("|");
}

export const useAuditLogsStore = create<AuditLogsState>((set, get) => ({
  rows: [],
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
        const rows = await listAuditLogs({ limit: AUDIT_LOG_LIMIT });
        const key = rowsSnapshotKey(rows);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({ rows, lastFetchedAt: Date.now(), error: null });
        } else {
          set({ lastFetchedAt: Date.now(), error: null });
        }
      } catch (error) {
        set({
          error: toUserFacingError(error, "Failed to load audit logs"),
          lastFetchedAt: Date.now(),
          rows: []
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
        const rows = await listAuditLogs({ limit: AUDIT_LOG_LIMIT });
        const key = rowsSnapshotKey(rows);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({ rows, lastFetchedAt: Date.now(), error: null });
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
  },

  startLiveSync: () => {
    if (get().liveSyncActive) {
      return;
    }
    set({ liveSyncActive: true });
    liveSync.start({
      getTenantId,
      tables: ["audit_logs"],
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
