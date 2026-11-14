import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BalanceDisclosure } from "../../app/api";
import {
  listAgentWithdrawalActivity,
  markAgentWithdrawalDelivered,
  markAgentWithdrawalsDeliveredBulk
} from "../../app/api";
import {
  canConfirmDelivery,
  isAgentDelivered,
  isCashFulfillment,
  isOfficeCashReady,
  isWithdrawalApproved
} from "./agentBalanceStore";

const STORAGE_KEY = "bms.agent.withdrawal-activity.v1";

function localDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayLocalKey(): string {
  return localDayKey(new Date().toISOString());
}

export type WithdrawalActivityTotals = {
  requestedAmount: number;
  requestedCount: number;
  approvedAmount: number;
  approvedCount: number;
  expectedOfficeCash: number;
  expectedOfficeCount: number;
  deliveredAmount: number;
  deliveredCount: number;
  pendingAmount: number;
  pendingCount: number;
};

type State = {
  items: BalanceDisclosure[];
  loading: boolean;
  deliveringId: string | null;
  deliveringBulk: boolean;
  error: string;
  lastFetchedAt: string | null;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  markDelivered: (disclosureId: string) => Promise<BalanceDisclosure>;
  markAllDelivered: (disclosureIds?: string[]) => Promise<number>;
};

let hydrateInFlight: Promise<void> | null = null;

function normalizeActivityRow(row: BalanceDisclosure): BalanceDisclosure {
  const raw = row as BalanceDisclosure & {
    agent_delivered_at?: string;
    agent_delivered_by?: string;
  };
  const agentDeliveredAt = raw.agentDeliveredAt || raw.agent_delivered_at || undefined;
  const agentDeliveredBy = raw.agentDeliveredBy || raw.agent_delivered_by || undefined;
  return {
    ...row,
    requestType: row.requestType ?? "withdrawal",
    agentDeliveredAt,
    agentDeliveredBy
  };
}

function upsertItems(items: BalanceDisclosure[], updated: BalanceDisclosure[]): BalanceDisclosure[] {
  const byId = new Map(items.map((row) => [row.id, normalizeActivityRow(row)]));
  for (const row of updated) {
    const next = normalizeActivityRow(row);
    const prev = byId.get(next.id);
    byId.set(next.id, {
      ...prev,
      ...next,
      // Never lose a local/server delivery confirmation on merge.
      agentDeliveredAt: next.agentDeliveredAt || prev?.agentDeliveredAt,
      agentDeliveredBy: next.agentDeliveredBy || prev?.agentDeliveredBy
    });
  }
  return [...byId.values()].sort(
    (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
  );
}

function mergeFetchedItems(
  previous: BalanceDisclosure[],
  fetched: BalanceDisclosure[]
): BalanceDisclosure[] {
  const prevById = new Map(previous.map((row) => [row.id, normalizeActivityRow(row)]));
  return fetched.map((row) => {
    const next = normalizeActivityRow(row);
    const prev = prevById.get(next.id);
    if (!prev?.agentDeliveredAt || next.agentDeliveredAt) {
      return next;
    }
    return {
      ...next,
      agentDeliveredAt: prev.agentDeliveredAt,
      agentDeliveredBy: next.agentDeliveredBy || prev.agentDeliveredBy
    };
  });
}

export const useAgentWithdrawalActivityStore = create<State>()(
  persist(
    (set, get) => ({
      items: [],
      loading: false,
      deliveringId: null,
      deliveringBulk: false,
      error: "",
      lastFetchedAt: null,

      hydrate(options) {
        const force = options?.force === true;
        const { lastFetchedAt, items } = get();
        const fresh =
          lastFetchedAt != null && Date.now() - new Date(lastFetchedAt).getTime() < 60_000;
        if (!force && items.length > 0 && fresh) {
          return;
        }
        void get().refresh();
      },

      async refreshSilent() {
        if (hydrateInFlight) {
          return hydrateInFlight;
        }
        hydrateInFlight = (async () => {
          try {
            const fetched = await listAgentWithdrawalActivity();
            set((s) => ({
              items: mergeFetchedItems(s.items, fetched),
              lastFetchedAt: new Date().toISOString(),
              error: ""
            }));
          } catch {
            /* keep cached */
          } finally {
            hydrateInFlight = null;
          }
        })();
        return hydrateInFlight;
      },

      async refresh() {
        set({ loading: true, error: "" });
        try {
          await get().refreshSilent();
        } finally {
          set({ loading: false });
        }
      },

      async markDelivered(disclosureId) {
        set({ deliveringId: disclosureId, error: "" });
        const deliveredAt = new Date().toISOString();
        try {
          const updated = await markAgentWithdrawalDelivered(disclosureId);
          const confirmed = normalizeActivityRow({
            ...updated,
            requestType: updated.requestType ?? "withdrawal",
            agentDeliveredAt: updated.agentDeliveredAt || deliveredAt,
            agentDeliveredBy: updated.agentDeliveredBy
          });
          set((s) => ({
            items: upsertItems(s.items, [confirmed]),
            deliveringId: null
          }));
          return confirmed;
        } catch (error) {
          set({
            deliveringId: null,
            error: error instanceof Error ? error.message : "Could not confirm delivery"
          });
          throw error;
        }
      },

      async markAllDelivered(disclosureIds) {
        set({ deliveringBulk: true, error: "" });
        const deliveredAt = new Date().toISOString();
        try {
          const updated = await markAgentWithdrawalsDeliveredBulk(disclosureIds);
          const confirmed = updated.map((row) =>
            normalizeActivityRow({
              ...row,
              requestType: row.requestType ?? "withdrawal",
              agentDeliveredAt: row.agentDeliveredAt || deliveredAt,
              agentDeliveredBy: row.agentDeliveredBy
            })
          );
          set((s) => ({
            items: upsertItems(s.items, confirmed),
            deliveringBulk: false
          }));
          return confirmed.length;
        } catch (error) {
          set({
            deliveringBulk: false,
            error: error instanceof Error ? error.message : "Could not confirm deliveries"
          });
          throw error;
        }
      }
    }),
    {
      name: STORAGE_KEY,
      partialize: (s) => ({
        items: s.items,
        lastFetchedAt: s.lastFetchedAt
      })
    }
  )
);

export function selectTodayWithdrawals(items: BalanceDisclosure[]): BalanceDisclosure[] {
  const today = todayLocalKey();
  return items.filter((row) => localDayKey(row.requestedAt) === today);
}

export function selectDeliverableIds(items: BalanceDisclosure[]): string[] {
  return items.filter((row) => canConfirmDelivery(row)).map((row) => row.id);
}

export function selectWithdrawalActivityTotals(
  items: BalanceDisclosure[],
  dayKey = todayLocalKey()
): WithdrawalActivityTotals {
  const dayRows = items.filter((row) => localDayKey(row.requestedAt) === dayKey);
  let requestedAmount = 0;
  let approvedAmount = 0;
  let approvedCount = 0;
  let expectedOfficeCash = 0;
  let expectedOfficeCount = 0;
  let deliveredAmount = 0;
  let deliveredCount = 0;
  let pendingAmount = 0;
  let pendingCount = 0;

  for (const row of dayRows) {
    const amount = Number(row.withdrawalAmount ?? 0);
    requestedAmount += amount;
    if (row.status === "pending") {
      pendingAmount += amount;
      pendingCount += 1;
    }
    if (isWithdrawalApproved(row)) {
      approvedAmount += amount;
      approvedCount += 1;
    }
    if (isOfficeCashReady(row)) {
      expectedOfficeCash += amount;
      expectedOfficeCount += 1;
    }
    if (isAgentDelivered(row)) {
      deliveredAmount += amount;
      deliveredCount += 1;
    }
  }

  return {
    requestedAmount,
    requestedCount: dayRows.length,
    approvedAmount,
    approvedCount,
    expectedOfficeCash,
    expectedOfficeCount,
    deliveredAmount,
    deliveredCount,
    pendingAmount,
    pendingCount
  };
}

export function withdrawalStatusLabel(row: BalanceDisclosure): string {
  if (isAgentDelivered(row)) {
    return "Delivered to customer";
  }
  if (row.status === "pending") {
    return "Awaiting approval";
  }
  if (row.status === "rejected") {
    return "Declined";
  }
  if (row.status === "cs_approved" || row.status === "bank_executed") {
    return isCashFulfillment(row.fulfillmentMode)
      ? "Approved — awaiting till"
      : "Approved";
  }
  if (row.status === "completed") {
    return isCashFulfillment(row.fulfillmentMode) ? "Cash ready at office" : "Completed";
  }
  if (row.status === "approved") {
    return row.fulfillmentMode === "momo" ? "MoMo sent" : "Approved";
  }
  return row.status;
}

export function withdrawalStatusTone(
  row: BalanceDisclosure
): "active" | "pending" | "inactive" {
  if (row.status === "rejected") {
    return "inactive";
  }
  if (isAgentDelivered(row) || row.status === "completed" || row.status === "approved") {
    return "active";
  }
  return "pending";
}
