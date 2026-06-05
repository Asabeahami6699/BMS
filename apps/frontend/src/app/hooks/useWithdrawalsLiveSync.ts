import { useEffect } from "react";
import { useWithdrawalsStore } from "../stores/withdrawalsStore";

export function useWithdrawalsLiveSync(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const store = useWithdrawalsStore.getState();
    store.hydrate();
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [enabled]);
}
