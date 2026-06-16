import { useEffect, useId } from "react";
import { usePageLoadingStore } from "../stores/pageLoadingStore";

/** Register component-local loading with the dashboard toolbar progress bar. */
export function usePageLoading(loading: boolean, sourceId?: string): void {
  const autoId = useId();
  const id = sourceId ?? autoId;
  const setLocalLoading = usePageLoadingStore((s) => s.setLocalLoading);

  useEffect(() => {
    setLocalLoading(id, loading);
    return () => setLocalLoading(id, false);
  }, [id, loading, setLocalLoading]);
}
