import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useUniversalOpsLiveSync } from "../hooks/useUniversalOpsLiveSync";
import { useUniversalOpsStore } from "../stores/universalOpsStore";
import { UniversalOpsFeatureGrid, UniversalOpsShell } from "./UniversalOpsShell";

type Props = { displayName?: string };

const MODULES = [
  { to: "/app/operations/attendance", label: "Attendance", hint: "Clock in, breaks, monthly reports" },
  { to: "/app/operations/leave", label: "Leave Management", hint: "Requests, balances, approvals" },
  { to: "/app/operations/staff-loans", label: "Staff Loans", hint: "Apply, repayments, schedules" },
  { to: "/app/operations/announcements", label: "Announcements", hint: "News, policies, holidays" },
  { to: "/app/operations/documents", label: "Documents Center", hint: "Handbooks, SOPs, circulars" },
  { to: "/app/operations/incidents", label: "Incident Reporting", hint: "Cash variances, fraud, complaints" }
];

function formatMoney(value?: number | null): string {
  if (value == null) {
    return "GHS —";
  }
  return `GHS ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function UniversalOpsDashboardPage({ displayName }: Props) {
  useUniversalOpsLiveSync({ force: true });

  const { summary, loading } = useUniversalOpsStore(
    useShallow((s) => ({
      summary: s.summary,
      loading: s.summaryLoading
    }))
  );

  const todayStatus = summary?.clockedIn
    ? `Clocked in${summary.checkIn ? ` at ${summary.checkIn.slice(0, 5)}` : ""}`
    : summary?.checkOut
      ? "Shift completed"
      : "Not clocked in";

  return (
    <UniversalOpsShell
      title="Staff operations hub"
      subtitle="Attendance, leave, loans, announcements, documents, and incident reporting in one place."
      displayName={displayName}
    >
      <section className="card universal-ops__kpi-row">
        <div className="universal-ops__kpi">
          <span className="muted">Today&apos;s status</span>
          <strong>{loading && !summary ? "Loading…" : todayStatus}</strong>
        </div>
        <div className="universal-ops__kpi">
          <span className="muted">Leave balance</span>
          <strong>{summary ? `${summary.leaveAvailable} days` : "— days"}</strong>
        </div>
        <div className="universal-ops__kpi">
          <span className="muted">Loan outstanding</span>
          <strong>{formatMoney(summary?.loanOutstanding)}</strong>
        </div>
        <div className="universal-ops__kpi">
          <span className="muted">Open incidents</span>
          <strong>{summary?.openIncidents ?? 0}</strong>
        </div>
      </section>

      <section className="card universal-ops__modules">
        <h3>Your workspace</h3>
        <div className="desk-link-grid">
          {MODULES.map((mod) => (
            <Link key={mod.to} className="desk-link-card" to={mod.to}>
              <strong>{mod.label}</strong>
              <span>{mod.hint}</span>
            </Link>
          ))}
        </div>
      </section>

      <UniversalOpsFeatureGrid
        items={[
          { title: "Self-service", description: "Clock attendance and submit leave without visiting HR." },
          { title: "Staff loans", description: "Apply for salary advances and track repayments." },
          { title: "Stay informed", description: "Read announcements and download compliance documents." },
          { title: "Report issues", description: "Escalate cash, fraud, and operational incidents securely." }
        ]}
      />
    </UniversalOpsShell>
  );
}
