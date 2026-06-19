import { Link } from "react-router-dom";
import { InitiateAgencyWithdrawalPanel } from "./InitiateAgencyWithdrawalPanel";

export function AgencyInitiateWithdrawalPage() {
  return (
    <div className="branch-counter agency-deposits-counter">
      <header className="branch-counter__toolbar">
        <div>
          <p className="role-workspace__eyebrow">Agency banking · Customer service</p>
          <h2>Initiate withdrawal</h2>
          <p className="muted branch-counter__subtitle">
            First point of contact — collect customer details and start the withdrawal for teller payout.
          </p>
        </div>
        <Link to="/app/banking/withdrawals" className="button secondary">
          ← Withdrawal desk
        </Link>
      </header>

      <InitiateAgencyWithdrawalPanel />
    </div>
  );
}
