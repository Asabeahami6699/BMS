import { UniversalOpsFeatureGrid, UniversalOpsShell } from "./UniversalOpsShell";

type Props = { displayName?: string };

const CATEGORIES = [
  "Internal news",
  "Product updates",
  "Meetings",
  "Policy changes",
  "Public holidays",
  "Training notices"
];

export function UniversalOpsAnnouncementsPage({ displayName }: Props) {
  return (
    <UniversalOpsShell
      title="Company Announcements"
      subtitle="Internal news, policy updates, and training notices from management."
      displayName={displayName}
    >
      <section className="card">
        <h3>Latest announcements</h3>
        <p className="muted">No announcements published yet. Check back for company updates.</p>
      </section>

      <section className="card">
        <h3>Categories</h3>
        <ul className="universal-ops__tag-list">
          {CATEGORIES.map((cat) => (
            <li key={cat}>{cat}</li>
          ))}
        </ul>
      </section>

      <UniversalOpsFeatureGrid
        items={[
          { title: "Read announcement", description: "Full message with attachments when provided." },
          { title: "Acknowledge receipt", description: "Confirm you have read mandatory notices." },
          { title: "Pinned items", description: "Important policies stay at the top until expiry." }
        ]}
      />
    </UniversalOpsShell>
  );
}
