import { useEffect } from "react";
import { useLoansStore } from "../stores/loansStore";

/** Mount-time hydrate + background live sync for the loans module. */
export function useLoansLiveSync(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const store = useLoansStore.getState();
    store.hydrate();
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [enabled]);
}
