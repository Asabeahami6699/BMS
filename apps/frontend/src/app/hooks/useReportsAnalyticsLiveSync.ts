import { useEffect } from "react";
import { useReportsAnalyticsStore } from "../stores/reportsAnalyticsStore";

export function useReportsAnalyticsLiveSync(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const store = useReportsAnalyticsStore.getState();
    store.hydrate();
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [enabled]);
}
