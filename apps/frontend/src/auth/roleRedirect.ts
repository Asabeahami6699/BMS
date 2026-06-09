import type { AppRole } from "../app/api";
import { isBuiltinRole } from "@bms/shared";
import { agencyDeskPathForRole } from "../app/banking/roleDeskConfig";

export function getHomePathForRole(role: string): string {
  switch (role) {
    case "super_admin":
      return "/platform/companies";
    case "admin":
      return "/app/dashboard";
    case "field_agent":
      return "/app/agent/home";
    case "teller":
      return "/app/banking/teller";
    case "customer_service":
      return "/app/banking/customer-service";
    case "back_officer":
      return "/app/banking/back-office";
    case "accountant":
      return "/app/banking/accountant";
    case "auditor":
      return "/app/banking/auditor";
    case "coordinator":
      return "/app/banking/operations";
    default: {
      if (isBuiltinRole(role)) {
        const desk = agencyDeskPathForRole(role as AppRole);
        if (desk) {
          return desk;
        }
      }
      return "/app/dashboard";
    }
  }
}
