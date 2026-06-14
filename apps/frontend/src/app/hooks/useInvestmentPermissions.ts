import { hasAnyPermission } from "@bms/shared";
import { useAuth } from "../../auth/AuthContext";

export function useInvestmentPermissions() {
  const { user } = useAuth();
  const permissions = user?.permissions;

  return {
    permissions,
    canRead: hasAnyPermission(permissions, ["investments.read"]),
    canManageProducts: hasAnyPermission(permissions, ["investments.products.manage"]),
    canCreateApplication: hasAnyPermission(permissions, ["investments.applications.create"]),
    canApprove: hasAnyPermission(permissions, ["investments.applications.approve"]),
    canRedeem: hasAnyPermission(permissions, ["investments.redeem"]),
    canManageForms: hasAnyPermission(permissions, ["investments.forms.manage"]),
    canViewReports: hasAnyPermission(permissions, ["investments.reports.read"])
  };
}
