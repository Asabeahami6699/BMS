import { create } from "zustand";
import {
  defaultLoanQualificationSetup,
  type LoanQualificationSetup
} from "@bms/shared";
import {
  getLoanQualificationSetup,
  getTenantId,
  updateLoanQualificationSetup
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createSilentRefreshScheduler,
  isFresh,
  runHydrate
} from "./storeSync";

type LoanQualificationState = {
  setup: LoanQualificationSetup;
  loading: boolean;
  saving: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  unavailable: boolean;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  save: (setup: LoanQualificationSetup) => Promise<LoanQualificationSetup>;
  setSetup: (setup: LoanQualificationSetup) => void;
};

let fetchInFlight: Promise<void> | null = null;
let lastSnapshotKey = "";
const silentScheduler = createSilentRefreshScheduler();

function setupSnapshotKey(setup: LoanQualificationSetup): string {
  return JSON.stringify(setup);
}

export const useLoanQualificationStore = create<LoanQualificationState>((set, get) => ({
  setup: defaultLoanQualificationSetup(),
  loading: false,
  saving: false,
  error: null,
  lastFetchedAt: null,
  unavailable: false,

  hydrate: (options) => {
    const { loading, lastFetchedAt } = get();
    runHydrate({
      force: options?.force,
      loading,
      lastFetchedAt,
      refresh: () => get().refresh(),
      refreshSilent: () => get().refreshSilent(),
      scheduleSilent: (run) => silentScheduler.schedule(run)
    });
  },

  setSetup: (setup) => {
    set({ setup, error: null, unavailable: false });
  },

  refresh: async () => {
    if (fetchInFlight) {
      set({ loading: true });
      await fetchInFlight;
      set({ loading: false });
      return;
    }

    set({ loading: true, error: null });
    fetchInFlight = (async () => {
      try {
        const data = await getLoanQualificationSetup();
        const key = setupSnapshotKey(data);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            setup: data,
            lastFetchedAt: Date.now(),
            error: null,
            unavailable: false
          });
        } else {
          set({ lastFetchedAt: Date.now(), error: null, unavailable: false });
        }
      } catch (error) {
        const message = toUserFacingError(error, "Failed to load loan qualification setup");
        const unavailable =
          /bridge|not enabled|403|forbidden|not available/i.test(message) ||
          (error instanceof Error && /403/.test(message));
        set({
          error: unavailable ? null : message,
          unavailable,
          lastFetchedAt: Date.now()
        });
      } finally {
        set({ loading: false });
        fetchInFlight = null;
      }
    })();
    await fetchInFlight;
  },

  refreshSilent: async () => {
    if (fetchInFlight) {
      return fetchInFlight;
    }
    if (isFresh(get().lastFetchedAt)) {
      return;
    }
    fetchInFlight = (async () => {
      try {
        const data = await getLoanQualificationSetup();
        const key = setupSnapshotKey(data);
        if (key !== lastSnapshotKey) {
          lastSnapshotKey = key;
          set({
            setup: data,
            lastFetchedAt: Date.now(),
            error: null,
            unavailable: false
          });
        } else {
          set({ lastFetchedAt: Date.now() });
        }
      } catch {
        /* keep cache */
      } finally {
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  },

  save: async (setup) => {
    set({ saving: true, error: null });
    try {
      const saved = await updateLoanQualificationSetup(setup);
      lastSnapshotKey = setupSnapshotKey(saved);
      set({
        setup: saved,
        lastFetchedAt: Date.now(),
        saving: false,
        unavailable: false
      });
      return saved;
    } catch (error) {
      set({
        saving: false,
        error: toUserFacingError(error, "Failed to save loan qualification setup")
      });
      throw error;
    }
  }
}));

/** Warm cache once per tenant session when Susu↔Loans features may be used. */
export function prefetchLoanQualificationSetup(): void {
  void getTenantId();
  useLoanQualificationStore.getState().hydrate();
}
