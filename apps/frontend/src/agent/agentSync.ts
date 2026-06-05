import type { CustomerRegistrationInput } from "@bms/shared";
import {
  addCollectionBatchLine,
  searchCustomers,
  submitCustomerRegistration,
  syncOfflineBatch,
  type Customer
} from "../app/api";
import { selectActiveCustomers, useAgentCustomerStore } from "./stores/agentCustomerStore";
import { useAgentCollectionStore } from "./stores/agentCollectionStore";
import {
  cacheCustomersForAgent,
  enqueueOfflineItem,
  getCachedCustomers,
  getOfflineQueue,
  removeOfflineItems
} from "../lib/offlineQueue";
import { toUserFacingError } from "../lib/networkError";

export async function refreshCustomerCache(): Promise<Customer[]> {
  await useAgentCustomerStore.getState().refreshSilent();
  return selectActiveCustomers(useAgentCustomerStore.getState());
}

export async function searchCustomersWithCache(query: string): Promise<Customer[]> {
  const q = query.trim();
  if (!q) {
    return [];
  }
  const filterCached = () => {
    const cached = getCachedCustomers<Customer>();
    const lower = q.toLowerCase();
    return cached.filter(
      (c) =>
        c.status === "active" &&
        (c.fullName.toLowerCase().includes(lower) ||
          (c.accountNumber?.toLowerCase().includes(lower) ?? false) ||
          c.phone.includes(q))
    );
  };

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return filterCached();
  }
  try {
    return await searchCustomers(q);
  } catch {
    return filterCached();
  }
}

export async function flushOfflineQueue(): Promise<{ synced: number; failed: number; errors: string[] }> {
  const queue = getOfflineQueue();
  if (queue.length === 0) {
    return { synced: 0, failed: 0, errors: [] };
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("No internet connection. Sync when you are back online.");
  }

  const result = await syncOfflineBatch(
    queue.map((item) =>
      item.type === "customer_registration"
        ? { type: "customer_registration" as const, clientId: item.clientId, payload: item.payload }
        : { type: "daily_collection" as const, clientId: item.clientId, payload: item.payload }
    )
  );
  const okIds = result.results.filter((r) => r.ok).map((r) => r.clientId);
  const failed = result.results.filter((r) => !r.ok);
  removeOfflineItems(okIds);

  return {
    synced: okIds.length,
    failed: failed.length,
    errors: failed.map((f) => f.error ?? "Unknown error")
  };
}

export async function submitRegistrationOnlineOrQueue(
  payload: CustomerRegistrationInput
): Promise<{ mode: "online" | "offline"; customer?: Customer }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    enqueueOfflineItem({ type: "customer_registration", payload });
    return { mode: "offline" };
  }
  try {
    const customer = await submitCustomerRegistration(payload);
    useAgentCustomerStore.getState().mergeCustomer(customer);
    return { mode: "online", customer };
  } catch (error) {
    if (toUserFacingError(error, "").includes("No internet connection")) {
      enqueueOfflineItem({ type: "customer_registration", payload });
      return { mode: "offline" };
    }
    throw error;
  }
}

export async function submitCollectionOnlineOrQueue(payload: {
  customerId: string;
  amount: number;
  transactionBranchId: string;
  notes?: string;
}): Promise<{ mode: "online" | "offline" }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    enqueueOfflineItem({ type: "daily_collection", payload });
    return { mode: "offline" };
  }
  try {
    await addCollectionBatchLine({
      ...payload,
      clientLineId: crypto.randomUUID()
    });
    await useAgentCustomerStore.getState().refreshSilent();
    return { mode: "online" };
  } catch (error) {
    if (toUserFacingError(error, "").includes("No internet connection")) {
      enqueueOfflineItem({ type: "daily_collection", payload });
      return { mode: "offline" };
    }
    throw error;
  }
}
