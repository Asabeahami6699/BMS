import type { AppRole } from "./api";
import { BranchCounterCard } from "./BranchCounterCard";

type Props = { role: AppRole };

/** Branch hall counter — deposits, withdrawals, and ledger for walk-in customers. */
export function TransactionLedgerCard({ role }: Props) {
  return <BranchCounterCard role={role} />;
}
