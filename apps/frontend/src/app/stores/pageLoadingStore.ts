import { create } from "zustand";
import { computeDashboardPageLoading } from "../dashboardPageLoading";

type PageLoadingState = {
  activePath: string;
  localSources: Record<string, boolean>;
  navigating: boolean;
  isLoading: boolean;
  setActivePath: (path: string) => void;
  setNavigating: (navigating: boolean) => void;
  setLocalLoading: (id: string, loading: boolean) => void;
  recompute: () => void;
};

export const usePageLoadingStore = create<PageLoadingState>((set, get) => ({
  activePath: "",
  localSources: {},
  navigating: false,
  isLoading: false,

  setActivePath: (path) => {
    set({ activePath: path });
    get().recompute();
  },

  setNavigating: (navigating) => {
    set({ navigating });
    get().recompute();
  },

  setLocalLoading: (id, loading) => {
    const next = { ...get().localSources };
    if (loading) {
      next[id] = true;
    } else {
      delete next[id];
    }
    set({ localSources: next });
    get().recompute();
  },

  recompute: () => {
    const { activePath, localSources, navigating } = get();
    const storeLoading = activePath ? computeDashboardPageLoading(activePath) : false;
    const localLoading = Object.values(localSources).some(Boolean);
    set({ isLoading: navigating || storeLoading || localLoading });
  }
}));
