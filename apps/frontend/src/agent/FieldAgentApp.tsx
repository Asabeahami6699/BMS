import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getAuthMe, getAuthSession, setRuntimeBranchId } from "../app/api";
import { useNetworkStatus } from "../lib/useNetworkStatus";
import { useAgentCollectionStore } from "./stores/agentCollectionStore";
import { useToast } from "../components/Toast";
import { getPendingCount } from "../lib/offlineQueue";
import { toUserFacingError } from "../lib/networkError";
import { useAgentCustomerLiveSync } from "./hooks/useAgentCustomerLiveSync";
import { useAgentRequestToasts } from "./hooks/useAgentRequestToasts";
import { flushOfflineQueue } from "./agentSync";
import { FieldAgentShell } from "./FieldAgentShell";
import { AgentAlertsPage } from "./pages/AgentAlertsPage";
import { AgentCallOverPage } from "./pages/AgentCallOverPage";
import { AgentCollectPage } from "./pages/AgentCollectPage";
import { AgentCustomersPage } from "./pages/AgentCustomersPage";
import { AgentHomePage } from "./pages/AgentHomePage";
import { useAgentBalanceStore } from "./stores/agentBalanceStore";
import { useAgentCustomerStore } from "./stores/agentCustomerStore";

export function FieldAgentApp() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [pendingCount, setPendingCount] = useState(getPendingCount());
  const [syncing, setSyncing] = useState(false);

  const { online } = useNetworkStatus();

  useAgentCustomerLiveSync(user?.tenantId);
  useAgentRequestToasts();

  const refreshPending = useCallback(() => setPendingCount(getPendingCount()), []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await flushOfflineQueue();
      await useAgentCustomerStore.getState().refreshSilent();
      await useAgentCollectionStore.getState().refreshToday();
      refreshPending();
      if (result.synced > 0) {
        showToast(`Synced ${result.synced} item(s)`, "success");
      }
      if (result.failed > 0) {
        showToast(`${result.failed} item(s) failed to sync`, "error");
      }
      if (result.synced === 0 && result.failed === 0) {
        showToast("Nothing to sync", "info");
      }
    } catch (error) {
      showToast(toUserFacingError(error, "Sync failed"), "error");
    } finally {
      setSyncing(false);
    }
  }, [refreshPending, showToast]);

  useEffect(() => {
    const cached = getAuthSession()?.user;
    if (cached?.branchId) {
      setRuntimeBranchId(cached.branchId);
    }
    if (online) {
      void getAuthMe()
        .then((me) => {
          if (me.branchId) {
            setRuntimeBranchId(me.branchId);
          }
        })
        .catch(() => undefined);
      void useAgentCollectionStore.getState().refreshToday();
      void useAgentBalanceStore.getState().refreshSilent();
    }
  }, [online]);

  useEffect(() => {
    function onOnline() {
      if (getPendingCount() > 0) {
        void handleSync();
      }
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [handleSync]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <FieldAgentShell onLogout={handleLogout}>
      <Routes>
        <Route index element={<Navigate to="home" replace />} />
        <Route path="home" element={<AgentHomePage />} />
        <Route path="customers" element={<AgentCustomersPage onQueueChange={refreshPending} />} />
        <Route path="register" element={<Navigate to="/app/agent/customers" replace />} />
        <Route
          path="collect"
          element={
            <AgentCollectPage
              onQueueChange={refreshPending}
              onSync={handleSync}
              syncing={syncing}
              pendingCount={pendingCount}
            />
          }
        />
        <Route path="callover" element={<AgentCallOverPage />} />
        <Route path="alerts" element={<AgentAlertsPage />} />
        <Route path="*" element={<Navigate to="home" replace />} />
      </Routes>
    </FieldAgentShell>
  );
}
