import { useEffect } from "react";
import { useCommissionStore } from "../stores/commissionStore";

/** Hydrate commission policy + background refresh. */
export function useCommissionLiveSync(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const store = useCommissionStore.getState();
    store.hydrate();
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [enabled]);
}
