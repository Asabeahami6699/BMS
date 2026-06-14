import { useEffect } from "react";
import { useInvestmentStore } from "../stores/investmentStore";

export function useInvestmentsLiveSync(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const store = useInvestmentStore.getState();
    store.hydrate();
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [enabled]);
}
