import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useTellerReconciliationStore } from "../stores/tellerReconciliationStore";
import { TellerReconciliationWorkbench } from "./TellerReconciliationWorkbench";

export function TellerReconciliationPage() {
  const { user } = useAuth();
  const lastFetchedAt = useTellerReconciliationStore((s) => s.lastFetchedAt);

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : "Loading…";

  return (
    <div className="agency-banking-page role-workspace">
      <header className="card role-workspace__hero workspace-animate-in">
        <p className="role-workspace__eyebrow">Agency banking · Teller</p>
        <div className="role-workspace__hero-row">
          <div>
            <h2>Teller reconciliation</h2>
            <p className="muted role-workspace__subtitle">
              Tabbed till reconciliation with branch, date, product, and type filters. {updatedLabel}
            </p>
          </div>
          <Link to="/app/banking/teller" className="button secondary">
            ← Teller desk
          </Link>
        </div>
      </header>

      <section className="card workspace-animate-in workspace-animate-in--2">
        <TellerReconciliationWorkbench fallbackBranchId={user?.branchId} />
      </section>
    </div>
  );
}
