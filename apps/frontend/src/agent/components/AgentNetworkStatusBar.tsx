import { useNetworkStatus } from "../../lib/useNetworkStatus";
import { useFieldAgentCapabilities } from "../hooks/useFieldAgentCapabilities";

export function AgentNetworkStatusBar() {
  const { online } = useNetworkStatus();
  const { canRegisterCustomers } = useFieldAgentCapabilities();

  if (online) {
    return null;
  }

  return (
    <div className="agent-offline-bar" role="status">
      {canRegisterCustomers
        ? "Offline mode — you can still collect and register. Data syncs when you are back online."
        : "Offline mode — you can still collect. Data syncs when you are back online."}
    </div>
  );
}
