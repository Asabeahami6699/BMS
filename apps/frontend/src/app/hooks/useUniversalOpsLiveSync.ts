import { useEffect } from "react";
import { useUniversalOpsStore } from "../stores/universalOpsStore";

export function useUniversalOpsLiveSync(options?: { force?: boolean; scope?: "all" | "attendance" | "leave" | "loans" | "announcements" | "documents" | "incidents" | "summary" }) {
  const force = options?.force;
  const scope = options?.scope ?? "all";

  useEffect(() => {
    const store = useUniversalOpsStore.getState();
    if (scope === "all") {
      store.hydrateAll(force ? { force: true } : undefined);
    } else if (scope === "summary") {
      store.refreshSummary();
    } else if (scope === "attendance") {
      store.refreshAttendance();
    } else if (scope === "leave") {
      store.refreshLeave();
    } else if (scope === "loans") {
      store.refreshLoans();
    } else if (scope === "announcements") {
      store.refreshAnnouncements();
    } else if (scope === "documents") {
      store.refreshDocuments();
    } else if (scope === "incidents") {
      store.refreshIncidents();
    }
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [force, scope]);
}
