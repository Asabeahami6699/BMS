import { useEffect } from "react";
import { useAgentsStore } from "../stores/agentsStore";

/** Hydrate field agents roster + background live sync. */
export function useAgentsLiveSync(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const store = useAgentsStore.getState();
    store.hydrate();
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [enabled]);
}
