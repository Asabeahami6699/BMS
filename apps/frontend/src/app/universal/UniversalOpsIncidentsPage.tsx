import { UniversalOpsFeatureGrid, UniversalOpsShell } from "./UniversalOpsShell";

type Props = { displayName?: string };

const INCIDENT_TYPES = [
  "Cash shortage",
  "Cash surplus",
  "Fraud suspicion",
  "Customer complaint",
  "System issue",
  "Security incident",
  "Operational error"
];

export function UniversalOpsIncidentsPage({ displayName }: Props) {
  return (
    <UniversalOpsShell
      title="Incident Reporting"
      subtitle="Report operational, cash, and security incidents for manager review."
      displayName={displayName}
      actions={
        <button type="button" className="button primary">
          Report incident
        </button>
      }
    >
      <section className="card universal-ops__kpi-row">
        <div className="universal-ops__kpi">
          <span className="muted">My incidents</span>
          <strong>0</strong>
        </div>
        <div className="universal-ops__kpi">
          <span className="muted">Pending cases</span>
          <strong>0</strong>
        </div>
        <div className="universal-ops__kpi">
          <span className="muted">Under investigation</span>
          <strong>0</strong>
        </div>
        <div className="universal-ops__kpi">
          <span className="muted">Resolved</span>
          <strong>0</strong>
        </div>
      </section>

      <section className="card">
        <h3>Incident types</h3>
        <ul className="universal-ops__tag-list">
          {INCIDENT_TYPES.map((type) => (
            <li key={type}>{type}</li>
          ))}
        </ul>
      </section>

      <section className="card workflow-steps">
        <h3>Workflow</h3>
        <ol>
          <li>Staff submits incident</li>
          <li>Manager review</li>
          <li>Investigation</li>
          <li>Resolution &amp; closure</li>
        </ol>
      </section>

      <UniversalOpsFeatureGrid
        items={[
          { title: "My incidents", description: "Cases you have filed with current status." },
          { title: "Pending cases", description: "Awaiting manager or compliance action." },
          { title: "Incident history", description: "Closed cases with resolution notes." }
        ]}
      />
    </UniversalOpsShell>
  );
}
