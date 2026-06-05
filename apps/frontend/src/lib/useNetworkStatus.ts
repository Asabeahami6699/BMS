import { useEffect, useState } from "react";

export function isBrowserOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/** True when the device is offline or a fetch failed due to network. */
export function isOfflineOrNetworkError(error: unknown): boolean {
  if (!isBrowserOnline()) {
    return true;
  }
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return msg.includes("fetch") || msg.includes("network") || msg.includes("failed to fetch");
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("no internet connection") || msg.includes("failed to fetch");
  }
  return false;
}

/**
 * Live online/offline flag for UI and to avoid clearing auth on refresh while offline.
 */
export function useNetworkStatus(): { online: boolean } {
  const [online, setOnline] = useState(isBrowserOnline);

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
    }
    function handleOffline() {
      setOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return { online };
}
