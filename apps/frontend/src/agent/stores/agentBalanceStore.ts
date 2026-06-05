import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BalanceDisclosure, CustomerRequestType, RequestCustomerApprovalInput } from "../../app/api";
import { listAgentBalanceDisclosures, requestCustomerApproval } from "../../app/api";
import { isOfflineOrNetworkError } from "../../lib/useNetworkStatus";

const STORAGE_KEY = "bms.agent.customer-requests.v2";

export function requestKey(customerId: string, type: CustomerRequestType): string {
  return `${customerId}:${type}`;
}

export function isBalanceVisible(d: BalanceDisclosure | undefined): boolean {
  if (!d || d.requestType !== "balance" || d.status !== "approved" || d.balanceAmount == null || !d.expiresAt) {
    return false;
  }
  return new Date(d.expiresAt).getTime() > Date.now();
}

export function isWithdrawalApproved(d: BalanceDisclosure | undefined): boolean {
  return Boolean(d && d.requestType === "withdrawal" && d.status === "approved");
}

export function balanceExpiresLabel(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) {
    return "Expired";
  }
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) {
    return `${hours}h ${mins}m left`;
  }
  return `${mins}m left`;
}

export function fulfillmentLabel(mode?: string): string {
  if (mode === "momo") {
    return "MoMo sent";
  }
  if (mode === "agent_next_day") {
    return "Agent brings cash";
  }
  return "Cash next day";
}

type State = {
  byKey: Record<string, BalanceDisclosure>;
  loading: boolean;
  error: string;
  lastFetchedAt: string | null;
  /** Bumped on an interval so approved-balance visibility re-renders when expiry passes. */
  visibilityClock: number;
  bumpVisibilityClock: () => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  submitRequest: (
    customerId: string,
    payload: RequestCustomerApprovalInput
  ) => Promise<BalanceDisclosure>;
  upsert: (d: BalanceDisclosure) => void;
  getForCustomer: (customerId: string, type: CustomerRequestType) => BalanceDisclosure | undefined;
};

function indexRequests(list: BalanceDisclosure[]): Record<string, BalanceDisclosure> {
  const map: Record<string, BalanceDisclosure> = {};
  for (const d of list) {
    const key = requestKey(d.customerId, d.requestType ?? "balance");
    const existing = map[key];
    if (!existing || new Date(d.requestedAt).getTime() >= new Date(existing.requestedAt).getTime()) {
      map[key] = d;
    }
  }
  return map;
}

let refreshInFlight: Promise<void> | null = null;

export const useAgentBalanceStore = create<State>()(
  persist(
    (set, get) => ({
      byKey: {},
      loading: false,
      error: "",
      lastFetchedAt: null,
      visibilityClock: 0,

      bumpVisibilityClock: () => set((s) => ({ visibilityClock: s.visibilityClock + 1 })),

      getForCustomer(customerId, type) {
        return get().byKey[requestKey(customerId, type)];
      },

      upsert(d) {
        const key = requestKey(d.customerId, d.requestType ?? "balance");
        set((s) => ({
          byKey: { ...s.byKey, [key]: d }
        }));
      },

      async refreshSilent() {
        if (refreshInFlight) {
          return refreshInFlight;
        }
        refreshInFlight = (async () => {
          try {
            const list = await listAgentBalanceDisclosures();
            set({
              byKey: indexRequests(list),
              lastFetchedAt: new Date().toISOString(),
              error: ""
            });
          } catch {
            /* keep cached requests */
          } finally {
            refreshInFlight = null;
          }
        })();
        return refreshInFlight;
      },

      async refresh() {
        set({ loading: true, error: "" });
        try {
          await get().refreshSilent();
        } finally {
          set({ loading: false });
        }
      },

      async submitRequest(customerId, payload) {
        const d = await requestCustomerApproval(customerId, payload);
        get().upsert(d);
        return d;
      }
    }),
    {
      name: STORAGE_KEY,
      partialize: (s) => ({
        byKey: s.byKey,
        lastFetchedAt: s.lastFetchedAt
      })
    }
  )
);

export function selectBalanceForCustomer(customerId: string) {
  return (s: State) => {
    void s.visibilityClock;
    return s.byKey[requestKey(customerId, "balance")];
  };
}

export function selectWithdrawalForCustomer(customerId: string) {
  return (s: State) => {
    void s.visibilityClock;
    return s.byKey[requestKey(customerId, "withdrawal")];
  };
}
