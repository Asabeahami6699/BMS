import { useEffect } from "react";
import { usePerformanceStore } from "../stores/performanceStore";

export function usePerformanceLiveSync(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const store = usePerformanceStore.getState();
    store.hydrate();
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [enabled]);
}
