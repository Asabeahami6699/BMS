import { create } from "zustand";
import type {
  SubscriptionPaymentClaimDto,
  SubscriptionPlanDto,
  TenantSubscriptionSnapshotDto
} from "../api";
import {
  activateMyFreeSubscription,
  getMySubscription,
  listTenantSubscriptionPlans,
  submitMySubscriptionPaymentClaim
} from "../api";
import { toUserFacingError } from "../../lib/networkError";
import {
  createSilentRefreshScheduler,
  runHydrate
} from "./storeSync";

type SubscriptionBillingState = {
  snapshot: TenantSubscriptionSnapshotDto | null;
  plans: SubscriptionPlanDto[];
  loading: boolean;
  submitting: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  hydrate: (options?: { force?: boolean }) => void;
  refresh: () => Promise<void>;
  refreshSilent: () => Promise<void>;
  submitClaim: (payload: {
    planId: string;
    momoReference: string;
    payerName: string;
    payerNumber: string;
    notes?: string;
  }) => Promise<SubscriptionPaymentClaimDto>;
  activateFree: () => Promise<TenantSubscriptionSnapshotDto>;
};

let fetchInFlight: Promise<void> | null = null;
const silentScheduler = createSilentRefreshScheduler();

export const useSubscriptionBillingStore = create<SubscriptionBillingState>((set, get) => ({
  snapshot: null,
  plans: [],
  loading: false,
  submitting: false,
  error: null,
  lastFetchedAt: null,

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
        const [snapshot, plans] = await Promise.all([
          getMySubscription(),
          listTenantSubscriptionPlans()
        ]);
        const uniquePlans = [
          ...new Map(
            plans
              .filter((plan) => plan.isActive !== false && !String(plan.id).startsWith("plan-"))
              .map((plan) => [plan.id, plan] as const)
          ).values()
        ];
        set({
          snapshot,
          plans: uniquePlans,
          loading: false,
          error: null,
          lastFetchedAt: Date.now()
        });
      } catch (error) {
        set({
          loading: false,
          error: toUserFacingError(error, "Failed to load subscription")
        });
      } finally {
        fetchInFlight = null;
      }
    })();
    await fetchInFlight;
  },

  refreshSilent: async () => {
    if (fetchInFlight) {
      await fetchInFlight;
      return;
    }
    fetchInFlight = (async () => {
      try {
        const [snapshot, plans] = await Promise.all([
          getMySubscription(),
          listTenantSubscriptionPlans()
        ]);
        const uniquePlans = [
          ...new Map(
            plans
              .filter((plan) => plan.isActive !== false && !String(plan.id).startsWith("plan-"))
              .map((plan) => [plan.id, plan] as const)
          ).values()
        ];
        set({
          snapshot,
          plans: uniquePlans,
          error: null,
          lastFetchedAt: Date.now()
        });
      } catch {
        // keep last good snapshot
      } finally {
        fetchInFlight = null;
      }
    })();
    await fetchInFlight;
  },

  submitClaim: async (payload) => {
    set({ submitting: true, error: null });
    try {
      const claim = await submitMySubscriptionPaymentClaim(payload);
      await get().refreshSilent();
      set({ submitting: false });
      return claim;
    } catch (error) {
      const message = toUserFacingError(error, "Failed to submit payment claim");
      set({ submitting: false, error: message });
      throw new Error(message);
    }
  },

  activateFree: async () => {
    set({ submitting: true, error: null });
    try {
      const snapshot = await activateMyFreeSubscription();
      set({ snapshot, submitting: false, lastFetchedAt: Date.now() });
      await get().refreshSilent();
      return snapshot;
    } catch (error) {
      const message = toUserFacingError(error, "Failed to start free plan");
      set({ submitting: false, error: message });
      throw new Error(message);
    }
  }
}));
