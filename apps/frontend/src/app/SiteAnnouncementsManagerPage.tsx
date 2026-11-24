import {
  formatAnnouncementCountdown,
  isSiteAnnouncementLive,
  type AnnouncementScope,
  type AnnouncementTimerMode,
  type AnnouncementTone,
  type SiteAnnouncement
} from "@bms/shared";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { useSiteAnnouncementsStore } from "./stores/siteAnnouncementsStore";

type Props = {
  scope: AnnouncementScope;
};

const DURATION_PRESETS = [
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1 hr", minutes: 60 },
  { label: "2 hrs", minutes: 120 },
  { label: "6 hrs", minutes: 360 },
  { label: "24 hrs", minutes: 1_440 }
] as const;

const TONE_OPTIONS: Array<{ value: AnnouncementTone; label: string; hint: string }> = [
  { value: "info", label: "Info", hint: "General update" },
  { value: "warning", label: "Warning", hint: "Maintenance / heads-up" },
  { value: "critical", label: "Critical", hint: "Urgent downtime / action" },
  { value: "success", label: "Success", hint: "Update complete" }
];

function toDatetimeLocalValue(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date(Date.now() + 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toneIcon(tone: AnnouncementTone): string {
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

export function SiteAnnouncementsManagerPage({ scope }: Props) {
  const { showToast } = useToast();
  const {
    managed,
    managedLoading,
    saving,
    busyId,
    error,
    hydrate,
    refresh,
    startLiveSync,
    stopLiveSync,
    create,
    update,
    stopNow,
    extendTimer,
    remove
  } = useSiteAnnouncementsStore(
    useShallow((s) => ({
      managed: s.managed,
      managedLoading: s.managedLoading,
      saving: s.saving,
      busyId: s.busyId,
      error: s.error,
      hydrate: s.hydrate,
      refresh: s.refresh,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync,
      create: s.create,
      update: s.update,
      stopNow: s.stopNow,
      extendTimer: s.extendTimer,
      remove: s.remove
    }))
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<AnnouncementTone>(scope === "platform" ? "warning" : "info");
  const [timerMode, setTimerMode] = useState<AnnouncementTimerMode>("duration");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [untilLocal, setUntilLocal] = useState(() => toDatetimeLocalValue(null));
  const [dismissible, setDismissible] = useState(true);
  const [replaceActive, setReplaceActive] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    hydrate();
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const scopedRows = useMemo(
    () => managed.filter((item) => item.scope === scope),
    [managed, scope]
  );

  const liveRows = useMemo(
    () => scopedRows.filter((item) => isSiteAnnouncementLive(item, nowMs)),
    [scopedRows, nowMs]
  );

  const historyRows = useMemo(
    () => scopedRows.filter((item) => !isSiteAnnouncementLive(item, nowMs)),
    [scopedRows, nowMs]
  );

  const previewExpiresAt = useMemo(() => {
    if (timerMode === "none") return null;
    if (timerMode === "until") {
      const ms = Date.parse(untilLocal);
      return Number.isNaN(ms) ? null : new Date(ms).toISOString();
    }
    const mins = Number(durationMinutes);
    if (!Number.isFinite(mins) || mins < 1) return null;
    return new Date(nowMs + Math.round(mins) * 60_000).toISOString();
  }, [timerMode, durationMinutes, untilLocal, nowMs]);

  const previewCountdown = formatAnnouncementCountdown(previewExpiresAt, nowMs);

  function resetComposer() {
    setEditingId(null);
    setTitle("");
    setMessage("");
    setTone(scope === "platform" ? "warning" : "info");
    setTimerMode("duration");
    setDurationMinutes("60");
    setUntilLocal(toDatetimeLocalValue(null));
    setDismissible(true);
    setReplaceActive(true);
  }

  function loadIntoComposer(item: SiteAnnouncement, mode: "edit" | "rebroadcast") {
    setEditingId(mode === "edit" ? item.id : null);
    setTitle(item.title ?? "");
    setMessage(item.message);
    setTone(item.tone);
    setDismissible(item.dismissible);
    if (item.durationMinutes) {
      setTimerMode("duration");
      setDurationMinutes(String(item.durationMinutes));
    } else if (item.expiresAt && mode === "edit" && Date.parse(item.expiresAt) > Date.now()) {
      setTimerMode("until");
      setUntilLocal(toDatetimeLocalValue(item.expiresAt));
    } else if (!item.expiresAt) {
      setTimerMode("none");
    } else {
      setTimerMode("duration");
      setDurationMinutes("60");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedMessage = message.trim();
    if (trimmedMessage.length < 3) {
      showToast("Enter an announcement message (at least 3 characters).", "error");
      return;
    }

    const parsedDuration = Math.floor(Number(durationMinutes));
    if (timerMode === "duration" && (!Number.isFinite(parsedDuration) || parsedDuration < 1)) {
      showToast("Enter a valid timer duration in minutes (at least 1).", "error");
      return;
    }

    let expiresAtIso: string | undefined;
    if (timerMode === "until") {
      const targetMs = Date.parse(untilLocal);
      if (Number.isNaN(targetMs) || targetMs <= Date.now()) {
        showToast("Pick a future end date and time.", "error");
        return;
      }
      expiresAtIso = new Date(targetMs).toISOString();
    }

    try {
      if (editingId) {
        await update(editingId, {
          title: title.trim() || null,
          message: trimmedMessage,
          tone,
          dismissible,
          isActive: true,
          timerMode,
          durationMinutes: timerMode === "duration" ? parsedDuration : null,
          expiresAt: timerMode === "until" ? expiresAtIso ?? null : undefined
        });
        showToast("Announcement updated and live.", "success");
      } else {
        await create({
          title: title.trim() || undefined,
          message: trimmedMessage,
          tone,
          dismissible,
          timerMode,
          durationMinutes: timerMode === "duration" ? parsedDuration : undefined,
          expiresAt: timerMode === "until" ? expiresAtIso : undefined,
          replaceActive
        });
        showToast(
          scope === "platform"
            ? "Site-wide announcement published to all companies."
            : "Announcement published to your company workspace.",
          "success"
        );
      }
      resetComposer();
    } catch (err) {
      showToast(toUserFacingError(err, "Could not publish announcement"), "error");
    }
  }

  async function handleStop(item: SiteAnnouncement) {
    try {
      await stopNow(item.id);
      if (editingId === item.id) {
        resetComposer();
      }
      showToast("Announcement stopped and removed from the floating bar.", "info");
    } catch (err) {
      showToast(toUserFacingError(err, "Could not stop announcement"), "error");
    }
  }

  async function handleExtend(item: SiteAnnouncement, minutes: number) {
    try {
      await extendTimer(item.id, minutes);
      showToast(`Extended timer by ${minutes >= 60 ? `${minutes / 60} hr` : `${minutes} min`}.`, "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Could not extend timer"), "error");
    }
  }

  async function handleDelete(item: SiteAnnouncement) {
    try {
      await remove(item.id);
      if (editingId === item.id) {
        resetComposer();
      }
      showToast("Announcement deleted.", "info");
    } catch (err) {
      showToast(toUserFacingError(err, "Could not delete announcement"), "error");
    }
  }

  const isPlatform = scope === "platform";

  return (
    <div className="ann-mgr">
      <header className="overview-hero ann-mgr__hero">
        <div className="overview-hero__body">
          <span className="overview-hero__eyebrow">
            {isPlatform ? "Platform broadcast" : "Company broadcast"}
          </span>
          <h2 className="overview-hero__title">
            {isPlatform ? "Site-wide Floating Announcements" : "Admin Floating Announcements"}
          </h2>
          <p className="overview-hero__subtitle">
            {isPlatform
              ? "Inform every company, back-office user, and field agent across the entire site with a single floating top bar and automatic countdown timer."
              : "Broadcast timely updates, branch reminders, or maintenance alerts across your company's dashboard and field agent app using the top floating bar."}
          </p>
        </div>
        <div className="overview-hero__actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => void refresh()}
            disabled={managedLoading}
          >
            {managedLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="banner banner--error" role="alert">
          {error}
        </div>
      ) : null}

      {/* Live Preview of the Exact Single Floating Bar */}
      <section className="card ann-mgr__preview-card" aria-label="Floating bar preview">
        <div className="ann-mgr__section-head">
          <div>
            <h3>Live floating bar preview</h3>
            <p className="muted">
              This is how your single floating bar appears at the top of the app.
            </p>
          </div>
          <span className="ann-mgr__pill">
            {isPlatform ? "Visible site-wide" : "Visible to your company"}
          </span>
        </div>

        <div className="ann-mgr__preview-stage">
          <div className={`site-ann-bar site-ann-bar--${tone}`}>
            <span className="site-ann-bar__icon" aria-hidden="true">
              {toneIcon(tone)}
            </span>
            <span className={`site-ann-bar__scope site-ann-bar__scope--${scope}`}>
              {isPlatform ? "System update" : "Admin notice"}
            </span>
            <div className="site-ann-bar__body">
              {title.trim() ? <strong className="site-ann-bar__title">{title.trim()}:</strong> : null}
              <span className="site-ann-bar__message">
                {message.trim() ||
                  (isPlatform
                    ? "Scheduled system update starts shortly — please save your work."
                    : "Example: Call-over closes at 4:30 PM today. Please submit all batches on time.")}
              </span>
            </div>
            <div className="site-ann-bar__meta">
              {previewCountdown ? (
                <span className="site-ann-bar__timer">
                  <span aria-hidden="true">⏱</span> {previewCountdown}
                </span>
              ) : null}
              {dismissible ? (
                <span className="site-ann-bar__close" aria-hidden="true">
                  ×
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* Composer */}
      <form className="card ann-mgr__composer" onSubmit={handleSubmit}>
        <div className="ann-mgr__section-head">
          <div>
            <h3>{editingId ? "Edit active announcement" : "Publish new announcement"}</h3>
            <p className="muted">
              Set the message, tone, and countdown timer. Once the timer ends, the floating bar hides automatically.
            </p>
          </div>
          {editingId ? (
            <button type="button" className="button secondary" onClick={resetComposer}>
              Cancel edit
            </button>
          ) : null}
        </div>

        <div className="ann-mgr__grid">
          <div className="field">
            <label htmlFor="ann-title">Short label (optional)</label>
            <input
              id="ann-title"
              type="text"
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={isPlatform ? "e.g. Scheduled Maintenance" : "e.g. Branch Notice"}
            />
          </div>

          <div className="field">
            <label>Alert style</label>
            <div className="ann-mgr__tones" role="radiogroup" aria-label="Announcement tone">
              {TONE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={tone === opt.value}
                  className={`ann-mgr__tone-btn ann-mgr__tone-btn--${opt.value}${tone === opt.value ? " is-selected" : ""}`}
                  onClick={() => setTone(opt.value)}
                  title={opt.hint}
                >
                  <span aria-hidden="true">{toneIcon(opt.value)}</span> {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="field">
          <div className="ann-mgr__label-row">
            <label htmlFor="ann-message">Announcement message</label>
            <span className="muted">{message.length} / 400</span>
          </div>
          <textarea
            id="ann-message"
            rows={3}
            maxLength={400}
            required
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              isPlatform
                ? "Write a concise site-wide update (e.g. System upgrade at 11:00 PM GMT — brief 5-minute downtime expected)."
                : "Write a clear company announcement for your staff and field agents."
            }
          />
        </div>

        {/* Message Timer Controls */}
        <div className="ann-mgr__timer-box">
          <div className="ann-mgr__section-head">
            <div>
              <strong>Message timer</strong>
              <p className="muted">
                Choose how long the floating bar stays live before automatically disappearing.
              </p>
            </div>
            <span className="ann-mgr__timer-summary">
              {timerMode === "none"
                ? "Stays live until stopped manually"
                : previewExpiresAt
                  ? `Auto-hides ${new Date(previewExpiresAt).toLocaleString()}`
                  : "Pick a valid timer"}
            </span>
          </div>

          <div className="ann-mgr__presets">
            {DURATION_PRESETS.map((preset) => {
              const selected = timerMode === "duration" && Number(durationMinutes) === preset.minutes;
              return (
                <button
                  key={preset.minutes}
                  type="button"
                  className={`ann-mgr__preset-btn${selected ? " is-selected" : ""}`}
                  onClick={() => {
                    setTimerMode("duration");
                    setDurationMinutes(String(preset.minutes));
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
            <button
              type="button"
              className={`ann-mgr__preset-btn${timerMode === "until" ? " is-selected" : ""}`}
              onClick={() => {
                setTimerMode("until");
                if (!untilLocal) setUntilLocal(toDatetimeLocalValue(null));
              }}
            >
              Pick date &amp; time
            </button>
            <button
              type="button"
              className={`ann-mgr__preset-btn${timerMode === "none" ? " is-selected" : ""}`}
              onClick={() => setTimerMode("none")}
            >
              Until manually stopped
            </button>
          </div>

          {timerMode === "duration" ? (
            <div className="ann-mgr__timer-input-row">
              <div className="field">
                <label htmlFor="ann-duration-mins">Custom duration (minutes)</label>
                <input
                  id="ann-duration-mins"
                  type="number"
                  min={1}
                  max={43200}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {timerMode === "until" ? (
            <div className="ann-mgr__timer-input-row">
              <div className="field">
                <label htmlFor="ann-until-dt">Auto-hide date &amp; time</label>
                <input
                  id="ann-until-dt"
                  type="datetime-local"
                  value={untilLocal}
                  onChange={(e) => setUntilLocal(e.target.value)}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="ann-mgr__toggles">
          <label className="ann-mgr__check">
            <input
              type="checkbox"
              checked={dismissible}
              onChange={(e) => setDismissible(e.target.checked)}
            />
            <span>Allow users to dismiss the floating bar (uncheck for critical pinned alerts)</span>
          </label>

          {!editingId ? (
            <label className="ann-mgr__check">
              <input
                type="checkbox"
                checked={replaceActive}
                onChange={(e) => setReplaceActive(e.target.checked)}
              />
              <span>Replace currently active {isPlatform ? "platform" : "company"} announcement</span>
            </label>
          ) : null}
        </div>

        <div className="ann-mgr__actions">
          <button type="submit" className="button" disabled={saving || Boolean(busyId)}>
            {saving
              ? "Publishing…"
              : editingId
                ? "Save & update live bar"
                : isPlatform
                  ? "Broadcast to entire site"
                  : "Publish to company"}
          </button>
        </div>
      </form>

      {/* Active Broadcasts */}
      <section className="card ann-mgr__list-card">
        <div className="ann-mgr__section-head">
          <div>
            <h3>Active right now ({liveRows.length})</h3>
            <p className="muted">
              Currently showing in the floating bar at the top of the app.
            </p>
          </div>
        </div>

        {liveRows.length === 0 ? (
          <p className="muted">
            No {isPlatform ? "site-wide" : "company"} floating announcement is currently live.
          </p>
        ) : (
          <div className="ann-mgr__items">
            {liveRows.map((item) => {
              const countdown = formatAnnouncementCountdown(item.expiresAt, nowMs);
              const isBusy = busyId === item.id;
              return (
                <article key={item.id} className={`ann-mgr__item ann-mgr__item--${item.tone}`}>
                  <div className="ann-mgr__item-main">
                    <div className="ann-mgr__item-top">
                      <span className="ann-mgr__status ann-mgr__status--live">LIVE</span>
                      <span className={`ann-mgr__tone-tag ann-mgr__tone-tag--${item.tone}`}>
                        {item.tone}
                      </span>
                      {countdown ? (
                        <span className="ann-mgr__countdown">⏱ Ends in {countdown}</span>
                      ) : (
                        <span className="muted">No timer (manual stop)</span>
                      )}
                      {!item.dismissible ? (
                        <span className="ann-mgr__pinned">Pinned</span>
                      ) : null}
                    </div>
                    <p className="ann-mgr__item-text">
                      {item.title ? <strong>{item.title}: </strong> : null}
                      {item.message}
                    </p>
                    <p className="muted ann-mgr__item-meta">
                      Published {new Date(item.createdAt).toLocaleString()}
                      {item.expiresAt
                        ? ` · Auto-ends ${new Date(item.expiresAt).toLocaleString()}`
                        : ""}
                    </p>
                  </div>
                  <div className="ann-mgr__item-actions">
                    <button
                      type="button"
                      className="button secondary button--sm"
                      disabled={isBusy}
                      onClick={() => void handleExtend(item, 15)}
                    >
                      +15m
                    </button>
                    <button
                      type="button"
                      className="button secondary button--sm"
                      disabled={isBusy}
                      onClick={() => void handleExtend(item, 60)}
                    >
                      +1h
                    </button>
                    <button
                      type="button"
                      className="button secondary button--sm"
                      disabled={isBusy}
                      onClick={() => loadIntoComposer(item, "edit")}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button danger button--sm"
                      disabled={isBusy}
                      onClick={() => void handleStop(item)}
                    >
                      Stop now
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Past / Expired / Stopped History */}
      {historyRows.length > 0 ? (
        <section className="card ann-mgr__list-card">
          <div className="ann-mgr__section-head">
            <div>
              <h3>Recent history ({historyRows.length})</h3>
              <p className="muted">Expired or stopped announcements you can reuse anytime.</p>
            </div>
          </div>

          <div className="ann-mgr__items">
            {historyRows.map((item) => {
              const expired = Boolean(item.expiresAt && Date.parse(item.expiresAt) <= nowMs && item.isActive);
              const isBusy = busyId === item.id;
              return (
                <article key={item.id} className="ann-mgr__item ann-mgr__item--history">
                  <div className="ann-mgr__item-main">
                    <div className="ann-mgr__item-top">
                      <span className="ann-mgr__status ann-mgr__status--ended">
                        {expired ? "EXPIRED" : "STOPPED"}
                      </span>
                      <span className={`ann-mgr__tone-tag ann-mgr__tone-tag--${item.tone}`}>
                        {item.tone}
                      </span>
                      <span className="muted">
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="ann-mgr__item-text">
                      {item.title ? <strong>{item.title}: </strong> : null}
                      {item.message}
                    </p>
                  </div>
                  <div className="ann-mgr__item-actions">
                    <button
                      type="button"
                      className="button secondary button--sm"
                      disabled={isBusy}
                      onClick={() => loadIntoComposer(item, "rebroadcast")}
                    >
                      Re-broadcast
                    </button>
                    <button
                      type="button"
                      className="button secondary button--sm"
                      disabled={isBusy}
                      onClick={() => void handleDelete(item)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
