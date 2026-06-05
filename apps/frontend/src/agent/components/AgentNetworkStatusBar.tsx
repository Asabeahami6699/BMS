import { useNetworkStatus } from "../../lib/useNetworkStatus";

export function AgentNetworkStatusBar() {
  const { online } = useNetworkStatus();

  if (online) {
    return null;
  }

  return (
    <div className="agent-offline-bar" role="status">
      Offline mode — you can still collect and register. Data syncs when you are back online.
    </div>
  );
}
