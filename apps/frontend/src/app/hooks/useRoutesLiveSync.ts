import { useEffect } from "react";
import { useRoutesStore } from "../stores/routesStore";

/** Hydrate routes list + background live sync. */
export function useRoutesLiveSync(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const store = useRoutesStore.getState();
    store.hydrate();
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [enabled]);
}
