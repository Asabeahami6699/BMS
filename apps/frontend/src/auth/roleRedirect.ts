import type { AppRole } from "../app/api";

export function getHomePathForRole(role: AppRole): string {
  switch (role) {
    case "super_admin":
      return "/platform/companies";
    case "admin":
      return "/app/overview";
    case "field_agent":
      return "/app/agent/home";
    case "coordinator":
      return "/app/reports";
    case "teller":
      return "/app/transactions";
    case "auditor":
    case "accountant":
      return "/app/reports";
    case "customer_service":
      return "/app/customers";
    default:
      return "/app/overview";
  }
}
