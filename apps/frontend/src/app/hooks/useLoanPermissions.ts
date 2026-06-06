import { hasAnyPermission } from "@bms/shared";
import { useAuth } from "../../auth/AuthContext";

export function useLoanPermissions() {
  const { user } = useAuth();
  const permissions = user?.permissions;

  return {
    permissions,
    canRead: hasAnyPermission(permissions, ["loans.read"]),
    canManageProducts: hasAnyPermission(permissions, ["loans.products.manage"]),
    canCreateApplication: hasAnyPermission(permissions, ["loans.applications.create"]),
    canApprove: hasAnyPermission(permissions, ["loans.applications.approve"]),
    canDisburse: hasAnyPermission(permissions, ["loans.disburse"]),
    canRecordRepayment: hasAnyPermission(permissions, ["loans.repayments.create"])
  };
}
