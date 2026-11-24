import {
  formatAnnouncementCountdown,
  isSiteAnnouncementLive,
  type SiteAnnouncement
} from "@bms/shared";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSiteAnnouncementsStore } from "../app/stores/siteAnnouncementsStore";

type Props = {
  variant?: "desktop" | "agent";
};

function toneIcon(tone: SiteAnnouncement["tone"]): string {
  switch (tone) {
    case "critical":
      return "⚠";
    case "warning":
      return "⚡";
    case "success":
      return "✓";
    default:
      return "📢";
  }
}

export function FloatingAnnouncementBar({ variant = "desktop" }: Props) {
  const { active, dismissedKeys, hydrateActive, startActiveLiveSync, stopActiveLiveSync, dismiss } =
    useSiteAnnouncementsStore(
      useShallow((s) => ({
        active: s.active,
        dismissedKeys: s.dismissedKeys,
        hydrateActive: s.hydrateActive,
        startActiveLiveSync: s.startActiveLiveSync,
        stopActiveLiveSync: s.stopActiveLiveSync,
        dismiss: s.dismiss
      }))
    );

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [cursor, setCursor] = useState(0);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    hydrateActive();
    startActiveLiveSync();
    return () => stopActiveLiveSync();
  }, [hydrateActive, startActiveLiveSync, stopActiveLiveSync]);

  const hasTimed = useMemo(() => active.some((a) => Boolean(a.expiresAt)), [active]);

  useEffect(() => {
    if (!hasTimed) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [hasTimed]);

  const visible = useMemo(
    () =>
      active.filter((item) => {
        if (!isSiteAnnouncementLive(item, nowMs)) return false;
        if (item.dismissible && dismissedKeys[item.id] === item.updatedAt) {
          return false;
        }
        return true;
      }),
    [active, dismissedKeys, nowMs]
  );

  useEffect(() => {
    if (visible.length <= 1 || hovered) return;
    const id = window.setInterval(() => {
      setCursor((prev) => (prev + 1) % visible.length);
    }, 8_000);
    return () => window.clearInterval(id);
  }, [visible.length, hovered]);

  if (visible.length === 0) {
    return null;
  }

  const safeIndex = cursor % visible.length;
  const current = visible[safeIndex]!;
  const countdown = formatAnnouncementCountdown(current.expiresAt, nowMs);
  const scopeLabel = current.scope === "platform" ? "System update" : "Admin notice";

  return (
    <div
      className={`site-ann-wrap site-ann-wrap--${variant}`}
      role="region"
      aria-label="Site announcement"
      aria-live="polite"
    >
      <div
        className={`site-ann-bar site-ann-bar--${current.tone}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <span className="site-ann-bar__icon" aria-hidden="true">
          {toneIcon(current.tone)}
        </span>

        <span
          className={`site-ann-bar__scope site-ann-bar__scope--${current.scope}`}
        >
          {scopeLabel}
        </span>

        <div className="site-ann-bar__body">
          {current.title ? <strong className="site-ann-bar__title">{current.title}:</strong> : null}
          <span className="site-ann-bar__message">{current.message}</span>
        </div>

        <div className="site-ann-bar__meta">
          {countdown ? (
            <span
              className="site-ann-bar__timer"
              title={
                current.expiresAt
                  ? `Automatically ends ${new Date(current.expiresAt).toLocaleString()}`
                  : undefined
              }
            >
              <span aria-hidden="true">⏱</span> {countdown}
            </span>
          ) : null}

          {visible.length > 1 ? (
            <div className="site-ann-bar__pager" aria-label="Switch announcement">
              <button
                type="button"
                className="site-ann-bar__pager-btn"
                aria-label="Previous announcement"
                onClick={() => setCursor((prev) => (prev - 1 + visible.length) % visible.length)}
              >
                ‹
              </button>
              <span className="site-ann-bar__pager-count">
                {safeIndex + 1}/{visible.length}
              </span>
              <button
                type="button"
                className="site-ann-bar__pager-btn"
                aria-label="Next announcement"
                onClick={() => setCursor((prev) => (prev + 1) % visible.length)}
              >
                ›
              </button>
            </div>
          ) : null}

          {current.dismissible ? (
            <button
              type="button"
              className="site-ann-bar__close"
              aria-label="Dismiss announcement"
              title="Dismiss"
              onClick={() => dismiss(current)}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
