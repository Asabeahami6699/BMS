import { subscribeToTenantRealtime } from "../app/realtime";
import { useAgentBalanceStore } from "./stores/agentBalanceStore";
import { useAgentCollectionStore } from "./stores/agentCollectionStore";
import { useAgentCustomerStore } from "./stores/agentCustomerStore";

/** Tables that affect agent customers, requests, and alerts. */
export const AGENT_LIVE_TABLES = [
  "customers",
  "customer_balance_disclosures",
  "agent_notifications",
  "customer_transactions"
] as const;

export const AGENT_LIVE_REFRESH_EVENT = "bms-agent-live-refresh";

const POLL_MS = 10_000;
const VISIBILITY_TICK_MS = 30_000;

let consumers = 0;
let tenantIdActive: string | undefined;
let realtimeUnsubscribe: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let visibilityTimer: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

export function refreshAgentLiveData(): void {
  void useAgentCustomerStore.getState().refreshSilent();
  void useAgentBalanceStore.getState().refreshSilent();
  void useAgentCollectionStore.getState().refreshToday();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AGENT_LIVE_REFRESH_EVENT));
  }
}

function scheduleRefresh(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    refreshAgentLiveData();
  }, 500);
}

function teardownChannels(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  realtimeUnsubscribe?.();
  realtimeUnsubscribe = null;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (visibilityTimer) {
    clearInterval(visibilityTimer);
    visibilityTimer = null;
  }
}

function setupChannels(tenantId: string): void {
  teardownChannels();
  tenantIdActive = tenantId;

  refreshAgentLiveData();

  realtimeUnsubscribe = subscribeToTenantRealtime({
    tenantId,
    tables: [...AGENT_LIVE_TABLES],
    onChange: scheduleRefresh
  });

  pollTimer = setInterval(() => {
    refreshAgentLiveData();
  }, POLL_MS);

  visibilityTimer = setInterval(() => {
    useAgentBalanceStore.getState().bumpVisibilityClock();
  }, VISIBILITY_TICK_MS);
}

export function startAgentLiveSync(tenantId: string): void {
  consumers += 1;
  if (realtimeUnsubscribe && tenantIdActive === tenantId) {
    return;
  }
  setupChannels(tenantId);
}

export function stopAgentLiveSync(): void {
  consumers = Math.max(0, consumers - 1);
  if (consumers > 0) {
    return;
  }
  teardownChannels();
  tenantIdActive = undefined;
}
