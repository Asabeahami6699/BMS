import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { initDashboardPageLoadingSubscriptions } from "../dashboardPageLoading";
import { usePageLoadingStore } from "../stores/pageLoadingStore";

const ROUTE_PULSE_MS = 320;

export function useDashboardPageLoading(): boolean {
  const location = useLocation();
  const isLoading = usePageLoadingStore((s) => s.isLoading);

  useEffect(() => {
    const recompute = () => usePageLoadingStore.getState().recompute();
    return initDashboardPageLoadingSubscriptions(recompute);
  }, []);

  useEffect(() => {
    usePageLoadingStore.getState().setActivePath(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    usePageLoadingStore.getState().setNavigating(true);
    const timer = window.setTimeout(() => {
      usePageLoadingStore.getState().setNavigating(false);
    }, ROUTE_PULSE_MS);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  return isLoading;
}
