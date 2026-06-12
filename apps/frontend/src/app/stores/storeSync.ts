import { subscribeToTenantRealtime } from "../realtime";

export const STALE_MS = 90_000;
export const LIVE_POLL_MS = 60_000;
export const SILENT_DEBOUNCE_MS = 600;

export function isFresh(lastFetchedAt: number | null, staleMs = STALE_MS): boolean {
  return lastFetchedAt != null && Date.now() - lastFetchedAt < staleMs;
}

export function createSilentRefreshScheduler() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(run: () => void) {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        run();
      }, SILENT_DEBOUNCE_MS);
    },
    clear() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }
  };
}

export type LiveSyncConfig = {
  getTenantId: () => string;
  tables: string[];
  onRefresh: () => void;
  isStale?: () => boolean;
  pollMs?: number;
  debounceMs?: number;
};

export function createLiveSyncManager() {
  let consumers = 0;
  let unsubscribe: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const scheduler = createSilentRefreshScheduler();

  return {
    start(config: LiveSyncConfig) {
      consumers += 1;
      if (consumers > 1) {
        return;
      }
      const pollMs = config.pollMs ?? LIVE_POLL_MS;
      const isStale = config.isStale ?? (() => true);
      const debounceMs = config.debounceMs ?? SILENT_DEBOUNCE_MS;
      const debouncedRefresh = () => scheduler.schedule(config.onRefresh);
      scheduler.schedule(config.onRefresh);
      unsubscribe = subscribeToTenantRealtime({
        tenantId: config.getTenantId(),
        tables: config.tables,
        onChange: debouncedRefresh
      });
      if (pollMs > 0) {
        pollTimer = setInterval(() => {
          if (typeof document !== "undefined" && document.hidden) {
            return;
          }
          if (!isStale()) {
            return;
          }
          debouncedRefresh();
        }, pollMs);
      }
    },
    stop() {
      consumers = Math.max(0, consumers - 1);
      if (consumers > 0) {
        return;
      }
      unsubscribe?.();
      unsubscribe = null;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      scheduler.clear();
    }
  };
}

export function runHydrate(opts: {
  force?: boolean;
  loading: boolean;
  lastFetchedAt: number | null;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  scheduleSilent: (run: () => void) => void;
}): void {
  if (opts.force) {
    void opts.refresh();
    return;
  }
  if (opts.loading) {
    return;
  }
  if (isFresh(opts.lastFetchedAt)) {
    return;
  }
  if (opts.lastFetchedAt != null) {
    opts.scheduleSilent(() => void opts.refreshSilent());
    return;
  }
  void opts.refresh();
}
