import { useEffect } from "react";
import { useGroupSavingsStore } from "../stores/groupSavingsStore";

export function useGroupSavingsLiveSync(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const store = useGroupSavingsStore.getState();
    store.hydrate();
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [enabled]);
}
