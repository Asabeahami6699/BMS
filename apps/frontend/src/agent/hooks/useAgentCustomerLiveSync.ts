import { useEffect } from "react";
import { useNetworkStatus } from "../../lib/useNetworkStatus";
import { refreshAgentLiveData, startAgentLiveSync, stopAgentLiveSync } from "../agentLiveSync";
import { useAgentCustomerStore } from "../stores/agentCustomerStore";

/**
 * Keeps agent customers, balance/withdrawal requests, collections, and alerts in sync
 * via Supabase realtime (when configured) plus periodic polling.
 */
export function useAgentCustomerLiveSync(tenantId: string | undefined): void {
  const { online } = useNetworkStatus();

  useEffect(() => {
    void useAgentCustomerStore.getState().ensureHydrated();
  }, []);

  useEffect(() => {
    if (!tenantId || !online) {
      stopAgentLiveSync();
      return;
    }

    startAgentLiveSync(tenantId);

    function onOnline() {
      refreshAgentLiveData();
    }
    window.addEventListener("online", onOnline);

    return () => {
      window.removeEventListener("online", onOnline);
      stopAgentLiveSync();
    };
  }, [tenantId, online]);
}
