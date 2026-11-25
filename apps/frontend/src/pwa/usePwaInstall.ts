import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const mediaStandalone = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone =
    "standalone" in window.navigator &&
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  return mediaStandalone || iosStandalone;
}

function isIosDevice(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/**
 * Module-level singleton capture for `beforeinstallprompt` / `appinstalled`.
 * Prevents losing the Chrome install prompt if it fires before `InstallAppButton`
 * mounts, during company branding hydration, or across route transitions.
 */
let capturedPrompt: BeforeInstallPromptEvent | null = null;
let capturedInstalled = isStandaloneDisplay();
let captureInitialized = false;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function initPwaInstallCapture(): void {
  if (captureInitialized || typeof window === "undefined") {
    return;
  }
  captureInitialized = true;
  capturedInstalled = isStandaloneDisplay();

  window.addEventListener("beforeinstallprompt", (event: Event) => {
    event.preventDefault();
    capturedPrompt = event as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener("appinstalled", () => {
    capturedPrompt = null;
    capturedInstalled = true;
    notifyListeners();
  });

  const media = window.matchMedia("(display-mode: standalone)");
  const onMediaChange = (event: MediaQueryListEvent) => {
    if (event.matches) {
      capturedInstalled = true;
      capturedPrompt = null;
      notifyListeners();
    }
  };
  media.addEventListener("change", onMediaChange);
}

export type PwaInstallState = {
  canInstall: boolean;
  installed: boolean;
  isIos: boolean;
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
};

export function usePwaInstall(): PwaInstallState {
  initPwaInstallCapture();

  const [, setVersion] = useState(0);
  const [isIos] = useState(isIosDevice);

  useEffect(() => {
    const sync = () => setVersion((v) => v + 1);
    listeners.add(sync);
    // Sync immediately in case standalone status changed before mount
    const nowStandalone = isStandaloneDisplay();
    if (nowStandalone !== capturedInstalled) {
      capturedInstalled = nowStandalone;
      sync();
    }
    return () => {
      listeners.delete(sync);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const promptEvent = capturedPrompt;
    if (!promptEvent) {
      return "unavailable" as const;
    }
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    capturedPrompt = null;
    if (outcome === "accepted") {
      capturedInstalled = true;
    }
    notifyListeners();
    return outcome;
  }, []);

  return {
    canInstall: Boolean(capturedPrompt) && !capturedInstalled,
    installed: capturedInstalled,
    isIos: isIos && !capturedInstalled,
    promptInstall
  };
}
