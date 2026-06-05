import { create } from "zustand";
import { listCustomers, type Customer } from "../../app/api";
import { cacheCustomersForAgent, getCachedCustomers } from "../../lib/offlineQueue";
import { toUserFacingError } from "../../lib/networkError";

const STORAGE_KEY = "bms.agent.customerStore.v1";

export type AgentCustomerFilter = "all" | "active" | "pending";

type PersistedPayload = {
  customers: Customer[];
  lastFetchedAt: number | null;
};

type AgentCustomerState = {
  customers: Customer[];
  loading: boolean;
  error: string | null;
  hydrated: boolean;
  lastFetchedAt: number | null;
  search: string;
  filter: AgentCustomerFilter;
  setSearch: (search: string) => void;
  setFilter: (filter: AgentCustomerFilter) => void;
  loadFromPersistence: () => void;
  setCustomers: (customers: Customer[]) => void;
  mergeCustomer: (customer: Customer) => void;
  ensureHydrated: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  refresh: () => Promise<void>;
};

function readPersisted(): PersistedPayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as PersistedPayload;
  } catch {
    return null;
  }
}

function writePersisted(customers: Customer[], lastFetchedAt: number | null): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ customers, lastFetchedAt } satisfies PersistedPayload)
  );
}

function sortCustomers(list: Customer[]): Customer[] {
  return [...list].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

function applyCustomers(customers: Customer[]): void {
  const sorted = sortCustomers(customers);
  cacheCustomersForAgent(sorted.filter((c) => c.status === "active"));
  writePersisted(sorted, Date.now());
}

let refreshInFlight: Promise<void> | null = null;
let hydrateInFlight: Promise<void> | null = null;

function customersSnapshotKey(customers: Customer[]): string {
  return customers
    .map(
      (c) =>
        `${c.id}:${c.status}:${c.dailyContributionAmount}:${c.fullName}:${c.location ?? ""}:${c.houseNumber ?? ""}:${c.accountNumber ?? ""}:${c.rejectionReason ?? ""}:${c.assignedFieldAgentId ?? ""}`
    )
    .join("|");
}

export const useAgentCustomerStore = create<AgentCustomerState>((set, get) => ({
  customers: [],
  loading: false,
  error: null,
  hydrated: false,
  lastFetchedAt: null,
  search: "",
  filter: "all",

  setSearch: (search) => set({ search }),

  setFilter: (filter) => set({ filter }),

  loadFromPersistence: () => {
    const saved = readPersisted();
    if (!saved?.customers.length) {
      return;
    }
    set({
      customers: saved.customers,
      lastFetchedAt: saved.lastFetchedAt,
      hydrated: true
    });
    cacheCustomersForAgent(saved.customers.filter((c) => c.status === "active"));
  },

  setCustomers: (customers) => {
    const sorted = sortCustomers(customers);
    const prevKey = customersSnapshotKey(get().customers);
    const nextKey = customersSnapshotKey(sorted);
    if (prevKey === nextKey) {
      set({ lastFetchedAt: Date.now(), error: null, hydrated: true });
      return;
    }
    applyCustomers(sorted);
    set({
      customers: sorted,
      lastFetchedAt: Date.now(),
      error: null,
      hydrated: true
    });
  },

  mergeCustomer: (customer) => {
    const existing = get().customers;
    const idx = existing.findIndex((c) => c.id === customer.id);
    const next =
      idx >= 0
        ? existing.map((c, i) => (i === idx ? customer : c))
        : [customer, ...existing];
    get().setCustomers(next);
  },

  ensureHydrated: async () => {
    if (get().hydrated) {
      return;
    }
    if (hydrateInFlight) {
      return hydrateInFlight;
    }
    hydrateInFlight = (async () => {
      get().loadFromPersistence();
      if (!get().customers.length) {
        await get().refresh();
      } else {
        set({ hydrated: true });
      }
    })().finally(() => {
      hydrateInFlight = null;
    });
    return hydrateInFlight;
  },

  refreshSilent: async () => {
    if (refreshInFlight) {
      return refreshInFlight;
    }
    refreshInFlight = (async () => {
      try {
        const customers = await listCustomers();
        get().setCustomers(customers);
      } catch {
        /* keep cached list */
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  },

  refresh: async () => {
    if (refreshInFlight) {
      set({ loading: true });
      try {
        await refreshInFlight;
      } finally {
        set({ loading: false, hydrated: true });
      }
      return;
    }

    set({ loading: true, error: null });
    refreshInFlight = (async () => {
      try {
        const customers = await listCustomers();
        get().setCustomers(customers);
      } catch (error) {
        const message = toUserFacingError(error, "Failed to load customers");
        set({ error: message });
        if (get().customers.length === 0) {
          const cached = getCachedCustomers<Customer>();
          if (cached.length > 0) {
            get().setCustomers(cached);
          }
        }
      } finally {
        set({ loading: false, hydrated: true });
        refreshInFlight = null;
      }
    })();
    await refreshInFlight;
  }
}));

export function selectFilteredCustomers(state: AgentCustomerState): Customer[] {
  const q = state.search.trim().toLowerCase();
  let list = state.customers;
  if (state.filter === "active") {
    list = list.filter((c) => c.status === "active");
  } else if (state.filter === "pending") {
    list = list.filter((c) => c.status === "pending_activation");
  }
  if (!q) {
    return list;
  }
  return list.filter(
    (c) =>
      c.fullName.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.location?.toLowerCase().includes(q) ?? false) ||
      (c.houseNumber?.toLowerCase().includes(q) ?? false) ||
      (c.accountNumber?.toLowerCase().includes(q) ?? false)
  );
}

export function selectActiveCustomers(state: AgentCustomerState): Customer[] {
  return state.customers.filter((c) => c.status === "active");
}

export function selectCustomerStats(state: AgentCustomerState) {
  const active = state.customers.filter((c) => c.status === "active").length;
  const pending = state.customers.filter((c) => c.status === "pending_activation").length;
  const rejected = state.customers.filter((c) => c.status === "rejected").length;
  return { total: state.customers.length, active, pending, rejected };
}

export function formatCustomerAddress(customer: Customer): string {
  const parts = [customer.location, customer.houseNumber].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "—";
}
