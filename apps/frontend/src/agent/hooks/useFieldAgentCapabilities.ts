import { useMemo } from "react";
import { useAuth } from "../../auth/AuthContext";

export type FieldAgentCapabilities = {
  canRegisterCustomers: boolean;
  canRequestWithdrawals: boolean;
  canRequestBalance: boolean;
  canViewPayroll: boolean;
};

/**
 * Reads the tenant-configured curated Field Agent capability switches
 * from the authenticated user's resolved permission set.
 */
export function useFieldAgentCapabilities(): FieldAgentCapabilities {
  const { user } = useAuth();
  const permissions = user?.permissions;

  return useMemo(() => {
    const perms = permissions ?? [];
    return {
      canRegisterCustomers: perms.includes("customers.create"),
      canRequestWithdrawals: perms.includes("field_agent.withdrawals.request"),
      canRequestBalance: perms.includes("field_agent.balance.request"),
      canViewPayroll: perms.includes("payroll.read")
    };
  }, [permissions]);
}
