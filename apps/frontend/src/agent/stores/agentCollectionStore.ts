import { create } from "zustand";
import {
  getFieldAgentTodayCollections,
  type FieldAgentTodayCollection,
  type FieldAgentTodayCollections
} from "../../app/api";
import { getOfflineQueue } from "../../lib/offlineQueue";

type AgentCollectionState = {
  customerIds: string[];
  items: FieldAgentTodayCollection[];
  totalAmount: number;
  batchStatus?: FieldAgentTodayCollections["batchStatus"];
  batchId?: string;
  loading: boolean;
  pendingLocalIds: string[];
  refreshToday: () => Promise<void>;
  markCollected: (customerId: string, amount: number) => void;
  isCollectedToday: (customerId: string) => boolean;
  canRecordCollections: () => boolean;
  setBatchPendingApproval: (batchId: string) => void;
};

function isTodayIso(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function offlineCollectedToday(): FieldAgentTodayCollection[] {
  return getOfflineQueue()
    .filter(
      (item): item is Extract<typeof item, { type: "daily_collection" }> =>
        item.type === "daily_collection" && isTodayIso(item.createdAt)
    )
    .map((item) => ({
      customerId: item.payload.customerId,
      amount: item.payload.amount,
      createdAt: item.createdAt
    }));
}

function buildState(
  server: FieldAgentTodayCollections,
  pendingLocal: FieldAgentTodayCollection[]
): Pick<
  AgentCollectionState,
  "customerIds" | "items" | "totalAmount" | "pendingLocalIds" | "batchStatus" | "batchId"
> {
  const serverItems = server.items;
  const byCustomer = new Map<string, FieldAgentTodayCollection>();
  for (const item of serverItems) {
    byCustomer.set(item.customerId, {
      ...item,
      entryCount: item.entryCount ?? 1
    });
  }
  for (const item of pendingLocal) {
    if (!byCustomer.has(item.customerId)) {
      byCustomer.set(item.customerId, { ...item, entryCount: 1 });
    }
  }
  const items = [...byCustomer.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    customerIds: items.map((i) => i.customerId),
    items,
    totalAmount: server.totalAmount > 0 ? server.totalAmount : items.reduce((sum, i) => sum + i.amount, 0),
    batchStatus: server.batchStatus,
    batchId: server.batchId,
    pendingLocalIds: pendingLocal
      .map((i) => i.customerId)
      .filter((id) => !serverItems.some((s) => s.customerId === id))
  };
}

export const useAgentCollectionStore = create<AgentCollectionState>((set, get) => ({
  customerIds: [],
  items: [],
  totalAmount: 0,
  batchStatus: undefined,
  batchId: undefined,
  loading: false,
  pendingLocalIds: [],

  isCollectedToday: (customerId) => get().customerIds.includes(customerId),

  canRecordCollections: () => {
    const status = get().batchStatus;
    return !status || status === "draft" || status === "rejected";
  },

  setBatchPendingApproval: (batchId) => {
    set({ batchStatus: "pending_approval", batchId });
  },

  markCollected: (customerId, amount) => {
    const pending = get().items.filter((i) => get().pendingLocalIds.includes(i.customerId));
    const existingPending = pending.find((p) => p.customerId === customerId);
    const localPending = existingPending
      ? pending.map((p) =>
          p.customerId === customerId
            ? {
                ...p,
                amount: p.amount + amount,
                entryCount: (p.entryCount ?? 1) + 1,
                createdAt: new Date().toISOString()
              }
            : p
        )
      : [
          ...pending,
          {
            customerId,
            amount,
            createdAt: new Date().toISOString(),
            entryCount: 1
          }
        ];
    const serverItems = get().items.filter((i) => !get().pendingLocalIds.includes(i.customerId));
    set(
      buildState(
        {
          items: serverItems,
          customerIds: serverItems.map((i) => i.customerId),
          totalAmount: serverItems.reduce((sum, i) => sum + i.amount, 0),
          batchStatus: get().batchStatus,
          batchId: get().batchId
        },
        localPending
      )
    );
  },

  refreshToday: async () => {
    set({ loading: true });
    try {
      const server = await getFieldAgentTodayCollections();
      const offline = offlineCollectedToday();
      const pending = [
        ...get().items.filter((i) => get().pendingLocalIds.includes(i.customerId)),
        ...offline
      ].filter(
        (item, index, arr) =>
          arr.findIndex((x) => x.customerId === item.customerId) === index &&
          !server.items.some((s) => s.customerId === item.customerId)
      );
      set({ ...buildState(server, pending), loading: false });
    } catch {
      const offline = offlineCollectedToday();
      const pending = [
        ...get().items.filter((i) => get().pendingLocalIds.includes(i.customerId)),
        ...offline
      ].filter(
        (item, index, arr) => arr.findIndex((x) => x.customerId === item.customerId) === index
      );
      set({
        ...buildState({ customerIds: [], totalAmount: 0, items: [] }, pending),
        loading: false
      });
    }
  }
}));
