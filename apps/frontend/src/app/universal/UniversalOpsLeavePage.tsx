import { UniversalOpsFeatureGrid, UniversalOpsShell } from "./UniversalOpsShell";

type Props = { displayName?: string };

const LEAVE_TYPES = ["Annual Leave", "Sick Leave", "Maternity Leave", "Compassionate Leave", "Study Leave"];

export function UniversalOpsLeavePage({ displayName }: Props) {
  return (
    <UniversalOpsShell
      title="Leave Management"
      subtitle="Submit requests, track balances, and view approval history."
      displayName={displayName}
      actions={
        <button type="button" className="button primary">
          Submit leave request
        </button>
      }
    >
      <section className="card universal-ops__kpi-row">
        <div className="universal-ops__kpi">
          <span className="muted">Available days</span>
          <strong>—</strong>
        </div>
        <div className="universal-ops__kpi">
          <span className="muted">Pending</span>
          <strong>0</strong>
        </div>
        <div className="universal-ops__kpi">
          <span className="muted">Approved</span>
          <strong>0</strong>
        </div>
        <div className="universal-ops__kpi">
          <span className="muted">Used this year</span>
          <strong>—</strong>
        </div>
      </section>

      <section className="card">
        <h3>Leave types</h3>
        <ul className="universal-ops__tag-list">
          {LEAVE_TYPES.map((type) => (
            <li key={type}>{type}</li>
          ))}
        </ul>
      </section>

      <UniversalOpsFeatureGrid
        items={[
          { title: "Submit request", description: "Choose dates, type, and optional notes for HR." },
          { title: "Pending requests", description: "Track items awaiting manager approval." },
          { title: "Approved leave", description: "Confirmed time off on your calendar." },
          { title: "Leave history", description: "Full archive of past requests and outcomes." }
        ]}
      />
    </UniversalOpsShell>
  );
}
