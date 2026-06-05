import { useEffect } from "react";
import type { AppRole } from "../api";
import { useCoordinatorStore } from "../stores/coordinatorStore";
import { useGroupSavingsStore } from "../stores/groupSavingsStore";
import { usePerformanceStore } from "../stores/performanceStore";
import { useWithdrawalsStore } from "../stores/withdrawalsStore";

type Options = {
  role: AppRole;
  enabled: boolean;
  loadCoordinator: boolean;
  loadWithdrawals: boolean;
  loadGroupSavings: boolean;
  loadPerformance: boolean;
};

function startStore(
  hydrate: (opts?: { force?: boolean }) => void,
  startLiveSync: () => void,
  stopLiveSync: () => void
): () => void {
  hydrate();
  startLiveSync();
  return stopLiveSync;
}

/** Hydrate overview data sources with live sync where applicable. */
export function useOverviewLiveSync({
  enabled,
  loadCoordinator,
  loadWithdrawals,
  loadGroupSavings,
  loadPerformance
}: Options): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const stops: Array<() => void> = [];

    if (loadCoordinator) {
      const s = useCoordinatorStore.getState();
      stops.push(startStore(s.hydrate, s.startLiveSync, s.stopLiveSync));
    }
    if (loadWithdrawals) {
      const s = useWithdrawalsStore.getState();
      stops.push(startStore(s.hydrate, s.startLiveSync, s.stopLiveSync));
    }
    if (loadGroupSavings) {
      const s = useGroupSavingsStore.getState();
      stops.push(startStore(s.hydrate, s.startLiveSync, s.stopLiveSync));
    }
    if (loadPerformance) {
      const s = usePerformanceStore.getState();
      stops.push(startStore(s.hydrate, s.startLiveSync, s.stopLiveSync));
    }

    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  }, [enabled, loadCoordinator, loadWithdrawals, loadGroupSavings, loadPerformance]);
}
