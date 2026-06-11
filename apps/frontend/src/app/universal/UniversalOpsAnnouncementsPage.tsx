import { FormEvent, useState } from "react";
import { ANNOUNCEMENT_CATEGORIES } from "@bms/shared";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../components/Toast";
import { useUniversalOpsLiveSync } from "../hooks/useUniversalOpsLiveSync";
import { useUniversalOpsStore } from "../stores/universalOpsStore";
import { UniversalOpsQuickLinks, UniversalOpsShell } from "./UniversalOpsShell";

type Props = { displayName?: string };

export function UniversalOpsAnnouncementsPage({ displayName }: Props) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const canPublish = user?.permissions?.includes("users.update");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<string>(ANNOUNCEMENT_CATEGORIES[0]);
  const [pinned, setPinned] = useState(false);
  useUniversalOpsLiveSync({ scope: "announcements" });

  const { announcements, loading, actionBusy, acknowledgeAnnouncement, publishAnnouncement, refreshAnnouncements } =
    useUniversalOpsStore(
      useShallow((s) => ({
        announcements: s.announcements,
        loading: s.announcementsLoading,
        actionBusy: s.actionBusy,
        acknowledgeAnnouncement: s.acknowledgeAnnouncement,
        publishAnnouncement: s.publishAnnouncement,
        refreshAnnouncements: s.refreshAnnouncements
      }))
    );

  async function handlePublish(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      return;
    }
    try {
      await publishAnnouncement({ title: title.trim(), body: body.trim(), category, pinned });
      showToast("Announcement published", "success");
      setShowForm(false);
      setTitle("");
      setBody("");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to publish", "error");
    }
  }

  return (
    <UniversalOpsShell
      title="Company Announcements"
      subtitle="Internal news, policy updates, and training notices from management."
      displayName={displayName}
      actions={
        <div className="universal-ops__actions">
          {canPublish ? (
            <button type="button" className="button primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? "Close" : "Publish announcement"}
            </button>
          ) : null}
          <button type="button" className="button secondary" onClick={() => void refreshAnnouncements()}>
            Refresh
          </button>
        </div>
      }
    >
      {showForm && canPublish ? (
        <form className="card stack-form" onSubmit={handlePublish}>
          <h3>Publish announcement</h3>
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {ANNOUNCEMENT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Message</span>
            <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} required />
          </label>
          <label className="field field--checkbox">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            <span>Pin to top</span>
          </label>
          <button type="submit" className="button primary" disabled={actionBusy}>
            {actionBusy ? "Publishing…" : "Publish"}
          </button>
        </form>
      ) : null}

      <section className="card">
        <h3>Latest announcements</h3>
        {loading && announcements.length === 0 ? <p className="muted">Loading…</p> : null}
        {!loading && announcements.length === 0 ? (
          <p className="muted">No announcements published yet. Check back for company updates.</p>
        ) : null}
        <div className="universal-ops__announce-list">
          {announcements.map((item) => (
            <article key={item.id} className={`universal-ops__announce-card${item.pinned ? " universal-ops__announce-card--pinned" : ""}`}>
              <div className="universal-ops__announce-head">
                <strong>{item.title}</strong>
                <span className="muted">{item.category}</span>
              </div>
              <p>{item.body}</p>
              <div className="universal-ops__announce-foot">
                <span className="muted">{new Date(item.publishedAt).toLocaleString()}</span>
                {!item.acknowledged ? (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      void acknowledgeAnnouncement(item.id).catch((err) =>
                        showToast(err instanceof Error ? err.message : "Failed", "error")
                      )
                    }
                  >
                    Acknowledge
                  </button>
                ) : (
                  <span className="status-pill status-pill--active">Acknowledged</span>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <UniversalOpsQuickLinks excludePath="operations/announcements" />
    </UniversalOpsShell>
  );
}
