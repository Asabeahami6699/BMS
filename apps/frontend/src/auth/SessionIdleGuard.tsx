import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuthSession, refreshAuthSession } from "../app/api";
import { withNetworkRetry } from "../lib/networkError";
import { useAuth } from "./AuthContext";
import {
  SESSION_ACTIVITY_THROTTLE_MS,
  SESSION_GRACE_MS,
  SESSION_IDLE_MS,
  SESSION_TOKEN_CHECK_MS,
  SESSION_UNAUTHORIZED_EVENT
} from "./sessionIdleConfig";
import { SessionExpiryModal } from "./SessionExpiryModal";
import { parseAccessTokenExpiryMs } from "./sessionUtils";

const GRACE_TOTAL_SECONDS = Math.ceil(SESSION_GRACE_MS / 1000);

const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart", "click"] as const;

export function SessionIdleGuard() {
  const { user, logout, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"warning" | "expired">("warning");
  const [secondsLeft, setSecondsLeft] = useState(GRACE_TOTAL_SECONDS);
  const [busy, setBusy] = useState(false);

  const lastActivityRef = useRef(Date.now());
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const graceEndsAtRef = useRef<number | null>(null);
  const openRef = useRef(false);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const clearGraceTimer = useCallback(() => {
    if (graceTimerRef.current) {
      clearInterval(graceTimerRef.current);
      graceTimerRef.current = null;
    }
    graceEndsAtRef.current = null;
  }, []);

  const handleSignOut = useCallback(async () => {
    setBusy(true);
    try {
      await logout();
      setOpen(false);
      openRef.current = false;
      navigate("/login", { replace: true });
    } finally {
      setBusy(false);
    }
  }, [logout, navigate]);

  const showExpired = useCallback(() => {
    clearIdleTimer();
    clearGraceTimer();
    setMode("expired");
    setOpen(true);
    openRef.current = true;
  }, [clearGraceTimer, clearIdleTimer]);

  const showWarning = useCallback(() => {
    if (openRef.current) {
      return;
    }
    clearIdleTimer();
    clearGraceTimer();
    const endsAt = Date.now() + SESSION_GRACE_MS;
    graceEndsAtRef.current = endsAt;
    setMode("warning");
    setSecondsLeft(GRACE_TOTAL_SECONDS);
    setOpen(true);
    openRef.current = true;

    graceTimerRef.current = setInterval(() => {
      const remainingMs = (graceEndsAtRef.current ?? Date.now()) - Date.now();
      const remainingSec = Math.ceil(remainingMs / 1000);
      setSecondsLeft(Math.max(0, remainingSec));
      if (remainingMs <= 0) {
        clearGraceTimer();
        void handleSignOut();
      }
    }, 1000);
  }, [clearGraceTimer, clearIdleTimer, handleSignOut]);

  const scheduleIdleWarning = useCallback(() => {
    clearIdleTimer();
    if (!user || openRef.current) {
      return;
    }

    const tokenExp = parseAccessTokenExpiryMs(getAuthSession()?.accessToken);
    const idleDeadline = lastActivityRef.current + SESSION_IDLE_MS;
    let triggerAt = idleDeadline;

    if (tokenExp != null) {
      const tokenWarningAt = tokenExp - SESSION_GRACE_MS;
      triggerAt = Math.min(idleDeadline, tokenWarningAt);
    }

    const delay = Math.max(0, triggerAt - Date.now());
    idleTimerRef.current = setTimeout(() => {
      if (tokenExp != null && tokenExp <= Date.now()) {
        showExpired();
        return;
      }
      showWarning();
    }, delay);
  }, [clearIdleTimer, showExpired, showWarning, user?.userId]);

  const resetIdleClock = useCallback(() => {
    if (!user || openRef.current) {
      return;
    }
    lastActivityRef.current = Date.now();
    scheduleIdleWarning();
  }, [scheduleIdleWarning, user?.userId]);

  const handleStaySignedIn = useCallback(async () => {
    setBusy(true);
    try {
      const refreshed = await withNetworkRetry(() => refreshAuthSession(), { maxMs: 10_000 });
      if (!refreshed) {
        showExpired();
        return;
      }
      await withNetworkRetry(() => refreshMe(), { maxMs: 10_000 });
      setOpen(false);
      openRef.current = false;
      clearGraceTimer();
      resetIdleClock();
    } catch {
      showExpired();
    } finally {
      setBusy(false);
    }
  }, [clearGraceTimer, refreshMe, resetIdleClock, showExpired]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!user && !openRef.current) {
      clearIdleTimer();
      clearGraceTimer();
      return;
    }

    if (!user) {
      return;
    }

    if (!openRef.current) {
      lastActivityRef.current = Date.now();
      scheduleIdleWarning();
    }

    let lastThrottled = 0;
    function onActivity() {
      const now = Date.now();
      if (now - lastThrottled < SESSION_ACTIVITY_THROTTLE_MS) {
        return;
      }
      lastThrottled = now;
      resetIdleClock();
    }

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }

    const tokenCheck = window.setInterval(() => {
      if (openRef.current) {
        return;
      }
      const tokenExp = parseAccessTokenExpiryMs(getAuthSession()?.accessToken);
      if (tokenExp != null && tokenExp <= Date.now()) {
        showExpired();
        return;
      }
      scheduleIdleWarning();
    }, SESSION_TOKEN_CHECK_MS);

    function onUnauthorized() {
      showExpired();
    }
    window.addEventListener(SESSION_UNAUTHORIZED_EVENT, onUnauthorized);

    return () => {
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, onActivity);
      }
      window.removeEventListener(SESSION_UNAUTHORIZED_EVENT, onUnauthorized);
      window.clearInterval(tokenCheck);
      clearIdleTimer();
      if (!openRef.current) {
        clearGraceTimer();
      }
    };
  }, [
    user?.userId,
    scheduleIdleWarning,
    resetIdleClock,
    clearGraceTimer,
    clearIdleTimer,
    showExpired
  ]);

  if (!user && !open) {
    return null;
  }

  return (
    <SessionExpiryModal
      open={open}
      mode={mode}
      secondsLeft={secondsLeft}
      totalSeconds={GRACE_TOTAL_SECONDS}
      busy={busy}
      onStaySignedIn={() => void handleStaySignedIn()}
      onSignOut={() => void handleSignOut()}
    />
  );
}
