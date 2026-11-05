import { create } from "zustand";
import type { Customer, LedgerEntry } from "../api";
import { getCustomer, getCustomerLedger, getTenantId } from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createLiveSyncManager,
  createSilentRefreshScheduler,
  isFresh
} from "./storeSync";

const LEDGER_STALE_MS = 90_000;
const DETAIL_STALE_MS = 5 * 60_000;
const EMPTY_LEDGER: LedgerEntry[] = [];

type CustomerLedgerState = {
  ledgerByCustomer: Record<string, LedgerEntry[]>;
  ledgerFetchedAt: Record<string, number>;
  detailByCustomer: Record<string, Customer>;
  detailFetchedAt: Record<string, number>;
  loadingByCustomer: Record<string, boolean>;
  errorByCustomer: Record<string, string | null>;
  liveSyncActive: boolean;

  ensureLedger: (customerId: string, options?: { force?: boolean }) => Promise<void>;
  ensureDetail: (customerId: string, options?: { force?: boolean }) => Promise<void>;
  invalidate: (customerId?: string) => void;
  startLiveSync: () => void;
  stopLiveSync: () => void;
};

const silentScheduler = createSilentRefreshScheduler();
const liveSync = createLiveSyncManager();
const ledgerInFlight = new Map<string, Promise<void>>();
const detailInFlight = new Map<string, Promise<void>>();
let watchedCustomerId: string | null = null;

export const useCustomerLedgerStore = create<CustomerLedgerState>((set, get) => ({
  ledgerByCustomer: {},
  ledgerFetchedAt: {},
  detailByCustomer: {},
  detailFetchedAt: {},
  loadingByCustomer: {},
  errorByCustomer: {},
  liveSyncActive: false,

  ensureLedger: async (customerId, options) => {
    if (!customerId) {
      return;
    }
    watchedCustomerId = customerId;
    const force = options?.force ?? false;
    const fetchedAt = get().ledgerFetchedAt[customerId];
    const cached = get().ledgerByCustomer[customerId];
    if (!force && cached && fetchedAt && Date.now() - fetchedAt < LEDGER_STALE_MS) {
      return;
    }

    const existing = ledgerInFlight.get(customerId);
    if (existing) {
      return existing;
    }

    const showLoader = !cached;
    if (showLoader) {
      set((state) => ({
        loadingByCustomer: { ...state.loadingByCustomer, [customerId]: true },
        errorByCustomer: { ...state.errorByCustomer, [customerId]: null }
      }));
    }

    const flight = (async () => {
      try {
        const data = await getCustomerLedger(customerId);
        set((state) => ({
          ledgerByCustomer: { ...state.ledgerByCustomer, [customerId]: data },
          ledgerFetchedAt: { ...state.ledgerFetchedAt, [customerId]: Date.now() },
          errorByCustomer: { ...state.errorByCustomer, [customerId]: null }
        }));
      } catch (error) {
        set((state) => ({
          errorByCustomer: {
            ...state.errorByCustomer,
            [customerId]: toUserFacingError(error, "Could not load ledger")
          },
          ...(state.ledgerByCustomer[customerId]
            ? {}
            : { ledgerByCustomer: { ...state.ledgerByCustomer, [customerId]: [] } })
        }));
      } finally {
        set((state) => ({
          loadingByCustomer: { ...state.loadingByCustomer, [customerId]: false }
        }));
        ledgerInFlight.delete(customerId);
      }
    })();

    ledgerInFlight.set(customerId, flight);
    return flight;
  },

  ensureDetail: async (customerId, options) => {
    if (!customerId) {
      return;
    }
    const force = options?.force ?? false;
    const fetchedAt = get().detailFetchedAt[customerId];
    const cached = get().detailByCustomer[customerId];
    const hasPhotos = Boolean(cached?.photoUrl || cached?.idCardPhotoUrl);
    if (!force && cached && hasPhotos && fetchedAt && Date.now() - fetchedAt < DETAIL_STALE_MS) {
      return;
    }

    const existing = detailInFlight.get(customerId);
    if (existing) {
      return existing;
    }

    const flight = (async () => {
      try {
        const full = await getCustomer(customerId);
        set((state) => ({
          detailByCustomer: { ...state.detailByCustomer, [customerId]: full },
          detailFetchedAt: { ...state.detailFetchedAt, [customerId]: Date.now() }
        }));
      } catch {
        /* keep prior detail/list snapshot */
      } finally {
        detailInFlight.delete(customerId);
      }
    })();

    detailInFlight.set(customerId, flight);
    return flight;
  },

  invalidate: (customerId) => {
    if (!customerId) {
      set({
        ledgerFetchedAt: {},
        detailFetchedAt: {}
      });
      return;
    }
    set((state) => {
      const ledgerFetchedAt = { ...state.ledgerFetchedAt };
      const detailFetchedAt = { ...state.detailFetchedAt };
      delete ledgerFetchedAt[customerId];
      delete detailFetchedAt[customerId];
      return { ledgerFetchedAt, detailFetchedAt };
    });
  },

  startLiveSync: () => {
    if (!get().liveSyncActive) {
      set({ liveSyncActive: true });
    }
    liveSync.start({
      getTenantId,
      tables: ["ledger_entries", "customer_transactions", "customers"],
      onRefresh: () => {
        const id = watchedCustomerId;
        if (!id) {
          return;
        }
        silentScheduler.schedule(() => {
          void get().ensureLedger(id, { force: true });
          void get().ensureDetail(id, { force: true });
        });
      },
      isStale: () => {
        const id = watchedCustomerId;
        if (!id) {
          return false;
        }
        return !isFresh(get().ledgerFetchedAt[id] ?? null, LEDGER_STALE_MS);
      }
    });
  },

  stopLiveSync: () => {
    liveSync.stop();
    silentScheduler.clear();
    if (get().liveSyncActive) {
      set({ liveSyncActive: false });
    }
  }
}));

export function selectLedgerForCustomer(
  state: CustomerLedgerState,
  customerId: string
): LedgerEntry[] {
  return customerId ? (state.ledgerByCustomer[customerId] ?? EMPTY_LEDGER) : EMPTY_LEDGER;
}

export function selectCustomerDetail(
  state: CustomerLedgerState,
  customerId: string
): Customer | undefined {
  return customerId ? state.detailByCustomer[customerId] : undefined;
}
