import { useEffect } from "react";
import { useCoordinatorsStore } from "../stores/coordinatorsStore";

/** Hydrate coordinators roster + background live sync. */
export function useCoordinatorsLiveSync(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const store = useCoordinatorsStore.getState();
    store.hydrate();
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [enabled]);
}
