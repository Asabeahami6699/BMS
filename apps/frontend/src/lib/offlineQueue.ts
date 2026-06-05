import type { CustomerRegistrationInput } from "@bms/shared";

export type OfflineQueueItem =
  | {
      clientId: string;
      type: "customer_registration";
      createdAt: string;
      payload: CustomerRegistrationInput;
    }
  | {
      clientId: string;
      type: "daily_collection";
      createdAt: string;
      payload: {
        customerId: string;
        amount: number;
        transactionBranchId: string;
        notes?: string;
      };
    };

const QUEUE_KEY = "bms.agent.offlineQueue";

function readQueue(): OfflineQueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) {
      return [];
    }
    return JSON.parse(raw) as OfflineQueueItem[];
  } catch {
    return [];
  }
}

function writeQueue(items: OfflineQueueItem[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export function getOfflineQueue(): OfflineQueueItem[] {
  return readQueue();
}

export function getPendingCount(): number {
  return readQueue().length;
}

export function enqueueOfflineItem(item: Omit<OfflineQueueItem, "clientId" | "createdAt">): OfflineQueueItem {
  const entry: OfflineQueueItem = {
    ...item,
    clientId: crypto.randomUUID(),
    createdAt: new Date().toISOString()
  } as OfflineQueueItem;
  writeQueue([...readQueue(), entry]);
  return entry;
}

export function removeOfflineItems(clientIds: string[]): void {
  const ids = new Set(clientIds);
  writeQueue(readQueue().filter((item) => !ids.has(item.clientId)));
}

export function cacheCustomersForAgent(customers: unknown[]): void {
  localStorage.setItem("bms.agent.customerCache", JSON.stringify(customers));
}

export function getCachedCustomers<T>(): T[] {
  try {
    const raw = localStorage.getItem("bms.agent.customerCache");
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}
