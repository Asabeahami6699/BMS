import { useEffect } from "react";
import { useBankProductsStore } from "../stores/bankProductsStore";

/** Mount-time hydrate + live sync for bank products (stable — does not re-run on store updates). */
export function useBankProductsLiveSync(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const store = useBankProductsStore.getState();
    store.hydrate({ force: true });
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [enabled]);
}
