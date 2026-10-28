import type { Permission } from "@bms/shared";
import type { AppRole } from "./api";
import { BranchCounterCard } from "./BranchCounterCard";

type Props = { role: AppRole; permissions?: Permission[] };

/** Branch hall counter — deposits, withdrawals, and ledger for walk-in customers. */
export function TransactionLedgerCard({ role, permissions }: Props) {
  return <BranchCounterCard role={role} permissions={permissions} />;
}
