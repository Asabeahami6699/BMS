import { useEffect } from "react";
import { useBranchesStore } from "../stores/branchesStore";

export function useBranchesLiveSync(options?: { force?: boolean }) {
  const force = options?.force;

  useEffect(() => {
    const store = useBranchesStore.getState();
    store.hydrate(force ? { force: true } : undefined);
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [force]);
}
