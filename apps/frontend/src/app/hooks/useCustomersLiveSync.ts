import { useEffect } from "react";
import { useCustomersStore } from "../stores/customersStore";

/** Mount-time hydrate + background live sync for the customers list. */
export function useCustomersLiveSync(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const store = useCustomersStore.getState();
    store.hydrate();
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [enabled]);
}
