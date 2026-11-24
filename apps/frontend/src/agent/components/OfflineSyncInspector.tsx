import { useEffect, useState } from "react";
import { flushOfflineQueue } from "../agentSync";
import { useAgentCollectionStore } from "../stores/agentCollectionStore";
import { useAgentCustomerStore } from "../stores/agentCustomerStore";
import { getOfflineQueue, type OfflineQueueItem } from "../../lib/offlineQueue";
import { useNetworkStatus } from "../../lib/useNetworkStatus";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";

export function OfflineSyncInspector() {
  const { online } = useNetworkStatus();
  const { showToast } = useToast();
  const customers = useAgentCustomerStore((s) => s.customers);
  const refreshToday = useAgentCollectionStore((s) => s.refreshToday);

  const [items, setItems] = useState<OfflineQueueItem[]>(() => getOfflineQueue());
  const [expanded, setExpanded] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const refresh = () => setItems(getOfflineQueue());
    refresh();
    const timer = window.setInterval(refresh, 4000);
    window.addEventListener("storage", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  if (items.length === 0) {
    return null;
  }

  const nameById = new Map(customers.map((c) => [c.id, c.fullName]));

  async function handleRetrySync() {
    if (!online || syncing) return;
    setSyncing(true);
    try {
      const res = await flushOfflineQueue();
      setItems(getOfflineQueue());
      if (res.synced > 0) {
        showToast(`Synced ${res.synced} queued item(s)`, "success");
        await refreshToday();
      }
      if (res.failed > 0) {
        showToast(res.errors[0] || `${res.failed} item(s) still failed to sync`, "error");
      }
    } catch (err) {
      showToast(toUserFacingError(err, "Sync failed"), "error");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <article className="card agent-card eod-guard-banner" role="status">
      <div className="eod-guard-banner__body">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
            flexWrap: "wrap"
          }}
        >
          <strong>
            Offline sync queue ({items.length} pending item{items.length === 1 ? "" : "s"})
          </strong>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button
              type="button"
              className="button secondary"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Hide" : "Inspect"}
            </button>
            <button
              type="button"
              className="button"
              disabled={!online || syncing}
              onClick={() => void handleRetrySync()}
            >
              {syncing ? "Syncing…" : online ? "Retry sync now" : "Offline"}
            </button>
          </div>
        </div>
        <p className="muted">
          Saved safely on this phone. Tap <strong>Retry sync now</strong> once connected to upload
          all queued collections and registrations.
        </p>

        {expanded ? (
          <div className="eod-guard-list" style={{ marginTop: "0.5rem" }}>
            {items.map((item) => (
              <div key={item.clientId} className="eod-guard-list__row">
                {item.type === "daily_collection" ? (
                  <span>
                    <strong>Daily collection</strong> ·{" "}
                    {nameById.get(item.payload.customerId) ?? item.payload.customerId} · GHS{" "}
                    {item.payload.amount.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}
                  </span>
                ) : (
                  <span>
                    <strong>New registration</strong> · {item.payload.fullName}
                  </span>
                )}
                <small className="muted">
                  {new Date(item.createdAt).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                </small>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
