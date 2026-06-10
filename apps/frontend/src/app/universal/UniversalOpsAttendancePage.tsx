import { UniversalOpsFeatureGrid, UniversalOpsShell } from "./UniversalOpsShell";

type Props = { displayName?: string };

export function UniversalOpsAttendancePage({ displayName }: Props) {
  return (
    <UniversalOpsShell
      title="Attendance"
      subtitle="Clock in and out, manage breaks, and review your attendance history."
      displayName={displayName}
      actions={
        <div className="universal-ops__actions">
          <button type="button" className="button primary">
            Clock in
          </button>
          <button type="button" className="button secondary" disabled>
            Clock out
          </button>
        </div>
      }
    >
      <section className="card universal-ops__kpi-row">
        <div className="universal-ops__kpi">
          <span className="muted">Clock in</span>
          <strong>—</strong>
        </div>
        <div className="universal-ops__kpi">
          <span className="muted">Clock out</span>
          <strong>—</strong>
        </div>
        <div className="universal-ops__kpi">
          <span className="muted">Hours worked</span>
          <strong>0h</strong>
        </div>
        <div className="universal-ops__kpi">
          <span className="muted">Attendance rate</span>
          <strong>—</strong>
        </div>
      </section>

      <UniversalOpsFeatureGrid
        items={[
          { title: "Clock in / out", description: "Record start and end of your working day." },
          { title: "Break in / out", description: "Track lunch and short breaks accurately." },
          { title: "Attendance history", description: "Daily log with late arrivals highlighted." },
          { title: "Monthly report", description: "Summary for payroll and HR review." }
        ]}
      />
    </UniversalOpsShell>
  );
}
