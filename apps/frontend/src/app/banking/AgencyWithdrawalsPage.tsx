import { Link } from "react-router-dom";
import type { AppRole } from "../api";
import { WithdrawalsPage } from "../WithdrawalsPage";
import { InitiateAgencyWithdrawalPanel } from "./InitiateAgencyWithdrawalPanel";
import { useWithdrawalsStore } from "../stores/withdrawalsStore";

type Props = {
  role: AppRole;
  permissions?: import("@bms/shared").Permission[];
};

/** Agency banking withdrawal verification — separate from Susu withdrawals nav. */
export function AgencyWithdrawalsPage({ role, permissions }: Props) {
  const refreshSilent = useWithdrawalsStore((s) => s.refreshSilent);

  return (
    <div className="agency-banking-page">
      <header className="card role-workspace__hero workspace-animate-in agency-withdrawals-header">
        <p className="role-workspace__eyebrow">Agency banking · Customer service</p>
        <div className="role-workspace__hero-row">
          <div>
            <h2>Withdrawal desk</h2>
            <p className="muted role-workspace__subtitle">
              Initiate walk-in withdrawals (sent straight to teller) or verify BMS member requests before
              teller cash payout.
            </p>
          </div>
          <Link to="/app/banking/customer-service" className="button secondary">
            ← CS desk
          </Link>
        </div>
      </header>

      <InitiateAgencyWithdrawalPanel onInitiated={() => void refreshSilent()} />

      <WithdrawalsPage role={role} permissions={permissions} variant="agency" />
    </div>
  );
}
