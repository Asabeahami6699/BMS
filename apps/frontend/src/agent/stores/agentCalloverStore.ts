import { create } from "zustand";
import type { CalloverVarianceType } from "../../app/api";

const STORAGE_KEY = "bms.agent.callover.discrepancies.v3";

export type CalloverDiscrepancy = {
  id: string;
  customerId: string;
  customerName: string;
  givenAmount: string;
  notes: string;
  reconciled: boolean;
};

type Persisted = {
  date: string;
  discrepancies: CalloverDiscrepancy[];
  verifiedMatch: boolean;
  checkedCustomerIds: string[];
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { date: todayKey(), discrepancies: [], verifiedMatch: false, checkedCustomerIds: [] };
    }
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed.date !== todayKey()) {
      return { date: todayKey(), discrepancies: [], verifiedMatch: false, checkedCustomerIds: [] };
    }
    return {
      ...parsed,
      checkedCustomerIds: parsed.checkedCustomerIds ?? []
    };
  } catch {
    return { date: todayKey(), discrepancies: [], verifiedMatch: false, checkedCustomerIds: [] };
  }
}

function writePersisted(state: {
  discrepancies: CalloverDiscrepancy[];
  verifiedMatch: boolean;
  checkedCustomerIds: string[];
}): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      date: todayKey(),
      discrepancies: state.discrepancies,
      verifiedMatch: state.verifiedMatch,
      checkedCustomerIds: state.checkedCustomerIds
    } satisfies Persisted)
  );
}

export function computeVariance(
  givenAmount: number,
  systemAmount: number
): { type: CalloverVarianceType; delta: number } {
  const delta = Math.round((givenAmount - systemAmount) * 100) / 100;
  if (givenAmount === 0 && systemAmount === 0) {
    return { type: "unresolved", delta: 0 };
  }
  if (Math.abs(delta) < 0.005) {
    return { type: "match", delta: 0 };
  }
  if (delta > 0) {
    return { type: "shortage", delta };
  }
  return { type: "overage", delta: Math.abs(delta) };
}

type CalloverState = {
  discrepancies: CalloverDiscrepancy[];
  verifiedMatch: boolean;
  checkedCustomerIds: string[];
  load: () => void;
  isChecked: (customerId: string) => boolean;
  toggleChecked: (customerId: string) => void;
  markAllChecked: (customerIds: string[]) => void;
  markAllMatch: () => void;
  addDiscrepancy: (customerId: string, customerName: string) => string;
  updateDiscrepancy: (id: string, patch: Partial<CalloverDiscrepancy>) => void;
  removeDiscrepancy: (id: string) => void;
  clearDiscrepancies: () => void;
};

export const useAgentCalloverStore = create<CalloverState>((set, get) => ({
  discrepancies: [],
  verifiedMatch: false,
  checkedCustomerIds: [],

  load: () => {
    const saved = readPersisted();
    set({
      discrepancies: saved.discrepancies,
      verifiedMatch: saved.verifiedMatch,
      checkedCustomerIds: saved.checkedCustomerIds
    });
  },

  isChecked: (customerId) => get().checkedCustomerIds.includes(customerId),

  toggleChecked: (customerId) => {
    const checked = get().checkedCustomerIds;
    const checkedCustomerIds = checked.includes(customerId)
      ? checked.filter((id) => id !== customerId)
      : [...checked, customerId];
    writePersisted({
      discrepancies: get().discrepancies,
      verifiedMatch: get().verifiedMatch,
      checkedCustomerIds
    });
    set({ checkedCustomerIds, verifiedMatch: false });
  },

  markAllChecked: (customerIds) => {
    const checkedCustomerIds = [...new Set([...get().checkedCustomerIds, ...customerIds])];
    writePersisted({
      discrepancies: get().discrepancies,
      verifiedMatch: get().verifiedMatch,
      checkedCustomerIds
    });
    set({ checkedCustomerIds });
  },

  markAllMatch: () => {
    writePersisted({ discrepancies: [], verifiedMatch: true, checkedCustomerIds: get().checkedCustomerIds });
    set({ discrepancies: [], verifiedMatch: true });
  },

  addDiscrepancy: (customerId, customerName) => {
    const id = crypto.randomUUID();
    const entry: CalloverDiscrepancy = {
      id,
      customerId,
      customerName,
      givenAmount: "",
      notes: "",
      reconciled: false
    };
    const discrepancies = [...get().discrepancies, entry];
    writePersisted({
      discrepancies,
      verifiedMatch: false,
      checkedCustomerIds: get().checkedCustomerIds
    });
    set({ discrepancies, verifiedMatch: false });
    return id;
  },

  updateDiscrepancy: (id, patch) => {
    const discrepancies = get().discrepancies.map((d) => (d.id === id ? { ...d, ...patch } : d));
    writePersisted({
      discrepancies,
      verifiedMatch: get().verifiedMatch,
      checkedCustomerIds: get().checkedCustomerIds
    });
    set({ discrepancies });
  },

  removeDiscrepancy: (id) => {
    const discrepancies = get().discrepancies.filter((d) => d.id !== id);
    writePersisted({
      discrepancies,
      verifiedMatch: get().verifiedMatch,
      checkedCustomerIds: get().checkedCustomerIds
    });
    set({ discrepancies });
  },

  clearDiscrepancies: () => {
    writePersisted({ discrepancies: [], verifiedMatch: false, checkedCustomerIds: [] });
    set({ discrepancies: [], verifiedMatch: false, checkedCustomerIds: [] });
  }
}));
