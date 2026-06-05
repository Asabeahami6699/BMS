import { useEffect } from "react";
import { useCoordinatorStore } from "../stores/coordinatorStore";

/** Hydrate coordinator data + background live sync (dashboard, approvals, reports). */
export function useCoordinatorLiveSync(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const store = useCoordinatorStore.getState();
    store.hydrate();
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [enabled]);
}
