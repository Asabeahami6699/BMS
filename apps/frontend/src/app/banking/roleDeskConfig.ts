import { hasAnyPermission, type Permission } from "@bms/shared";
import type { AppRole } from "../api";
import type { RoleWorkspaceKind } from "../stores/roleWorkspaceStore";

export type RoleDeskConfig = {
  kind: RoleWorkspaceKind;
  path: string;
  title: string;
  eyebrow: string;
  subtitle: string;
  accent: "blue" | "emerald" | "amber" | "violet" | "rose" | "slate";
  roles: AppRole[];
  anyPermissions?: Permission[];
  workflow: string[];
  quickLinks: Array<{ to: string; label: string; description: string }>;
  placeholderFeatures?: string[];
};

/** Agency banking role desks — all routes live under /app/banking/* */
export const AGENCY_ROLE_DESKS: RoleDeskConfig[] = [
  {
    kind: "teller",
    path: "banking/teller",
    title: "Teller desk",
    eyebrow: "Cash operator",
    subtitle: "Receive deposits, pay verified withdrawals, and maintain your drawer float.",
    accent: "emerald",
    roles: ["teller", "admin"],
    anyPermissions: ["agency.deposits.record", "agency.withdrawals.pay"],
    workflow: [
      "Record customer deposit at till",
      "Back office credits account at bank",
      "Pay cash only after Customer Service verification"
    ],
    quickLinks: [
      { to: "/app/banking/deposits", label: "Record deposit", description: "Walk-in cash at the till" },
      { to: "/app/banking/reconciliation", label: "Reconciliation", description: "Opening, closing & variance" },
      { to: "/app/banking/till-daybook", label: "Till daybook", description: "Cash to bank, expenses & drawer" },
      { to: "/app/banking/teller", label: "Payout queue", description: "Approved cash withdrawals" }
    ]
  },
  {
    kind: "customer_service",
    path: "banking/customer-service",
    title: "Customer service",
    eyebrow: "Withdrawal control",
    subtitle:
      "First point of contact — collect customer details and enter withdrawal transactions.",
    accent: "blue",
    roles: ["customer_service", "admin"],
    anyPermissions: ["agency.withdrawals.approve"],
    workflow: [
      "Customer arrives — CS collects identity and account details",
      "Initiate withdrawal (walk-in goes straight to teller)",
      "BMS verification happens on the withdrawal desk, not here"
    ],
    quickLinks: [
      {
        to: "/app/banking/withdrawals/initiate",
        label: "Initiate withdrawal",
        description: "Collect details & start a withdrawal request"
      },
      { to: "/app/banking/withdrawals", label: "Withdrawal desk", description: "Full queue, filters & MoMo" },
      { to: "/app/banking/account-opening", label: "Account opening", description: "Record partner bank accounts" },
      { to: "/app/banking", label: "Agency overview", description: "Queue counts & workflow" },
      { to: "/app/banking/products", label: "Bank products", description: "Withdrawal product types" }
    ]
  },
  {
    kind: "back_officer",
    path: "banking/back-office",
    title: "Back office",
    eyebrow: "Bank execution",
    subtitle: "Execute teller deposits at the agency bank and maintain settlement accuracy.",
    accent: "amber",
    roles: ["back_officer", "admin"],
    anyPermissions: ["agency.bank.execute"],
    workflow: [
      "Teller records physical deposit",
      "Credit customer account at partner bank",
      "Ledger reconciles when execution completes"
    ],
    quickLinks: [
      { to: "/app/banking/back-office#deposits", label: "Deposit queue", description: "Teller deposits pending bank" },
      { to: "/app/banking/back-office#balancing", label: "Account balancing", description: "Opening balances & ecash" },
      {
        to: "/app/banking/back-office#reconciliation",
        label: "Teller/Back Officer reconciliation",
        description: "Teller vs back office per drawer"
      },
      { to: "/app/banking/products", label: "Bank products", description: "Deposit & withdrawal types" }
    ]
  },
  {
    kind: "accountant",
    path: "banking/accountant",
    title: "Accountant",
    eyebrow: "Finance & ledger",
    subtitle: "Trial balance, reconciliation, and financial reporting for agency banking.",
    accent: "violet",
    roles: ["accountant", "admin"],
    anyPermissions: ["ledger.read", "reports.read"],
    workflow: [
      "Review agency ledger and cash positions",
      "Reconcile vault vs teller vs bank",
      "Produce management reports"
    ],
    quickLinks: [
      { to: "/app/banking/accountant/approvals", label: "Approvals queue", description: "Large deposits & ecash" },
      { to: "/app/banking/accountant/reports", label: "Reports", description: "Analytics dashboard" },
      { to: "/app/banking/accountant/trial-balance", label: "Trial balance", description: "Cash reconciliation" }
    ]
  },
  {
    kind: "auditor",
    path: "banking/auditor",
    title: "Auditor",
    eyebrow: "Assurance",
    subtitle: "Read-only oversight across agency transactions and audit trails.",
    accent: "slate",
    roles: ["auditor", "admin"],
    anyPermissions: ["audit.read", "transactions.read"],
    workflow: [
      "Sample agency transaction populations",
      "Trace approval chains",
      "Review segregation of duties"
    ],
    quickLinks: [
      { to: "/app/banking/auditor/logs", label: "Audit logs", description: "Who did what, when" },
      { to: "/app/banking/auditor/exceptions", label: "Exceptions", description: "Failed actions & queues" },
      { to: "/app/banking/auditor/reports", label: "Reports", description: "Operational analytics" }
    ]
  },
  {
    kind: "hrm",
    path: "banking/hrm",
    title: "Human resources",
    eyebrow: "People operations",
    subtitle: "Staff directory, payroll, and job titles for agency banking branches.",
    accent: "rose",
    roles: ["admin", "coordinator"],
    anyPermissions: ["users.read"],
    workflow: [
      "Onboard branch staff",
      "Track leave and attendance",
      "Link performance to compensation"
    ],
    quickLinks: [
      { to: "/app/banking/hrm/profiles", label: "Employee profiles", description: "Staff accounts" },
      { to: "/app/banking/hrm/attendance", label: "Attendance", description: "Daily register" },
      { to: "/app/banking/hrm/leave", label: "Leave", description: "Requests & approvals" },
      { to: "/app/banking/hrm/payroll", label: "Payroll", description: "Runs & payslips" }
    ]
  },
  {
    kind: "operations",
    path: "banking/operations",
    title: "Branch operations",
    eyebrow: "Branch manager",
    subtitle: "Branch performance, cash control, and agency banking oversight.",
    accent: "blue",
    roles: ["coordinator", "admin"],
    anyPermissions: ["reports.read", "treasury.read"],
    workflow: [
      "Monitor agency queues and cash position",
      "Review teller and back-office throughput",
      "Escalate exceptions to head office"
    ],
    quickLinks: [
      { to: "/app/banking", label: "Agency overview", description: "Queues & workflow" },
      { to: "/app/treasury", label: "Treasury", description: "Vault & bank cash" },
      { to: "/app/reports", label: "Reports", description: "Branch analytics" }
    ],
    placeholderFeatures: [
      "Branch scorecard",
      "Queue SLA alerts",
      "Staff roster by shift",
      "Daily operations checklist"
    ]
  }
];

export function getRoleDeskConfig(kind: RoleWorkspaceKind): RoleDeskConfig {
  const found = AGENCY_ROLE_DESKS.find((w) => w.kind === kind);
  if (!found) {
    throw new Error(`Unknown agency desk: ${kind}`);
  }
  return found;
}

export function canAccessRoleDesk(
  kind: RoleWorkspaceKind,
  role: AppRole | string,
  permissions?: Permission[]
): boolean {
  const config = getRoleDeskConfig(kind);
  if (role === "admin") {
    return true;
  }
  if (config.roles.includes(role as AppRole)) {
    return true;
  }
  if (config.anyPermissions?.length) {
    return hasAnyPermission(permissions, config.anyPermissions);
  }
  return false;
}

export function agencyDeskPathForRole(role: AppRole | string): string | null {
  const kind = primaryAgencyDeskForRole(role);
  if (!kind) {
    return null;
  }
  return `/app/${getRoleDeskConfig(kind).path}`;
}

export function primaryAgencyDeskForRole(role: AppRole | string): RoleWorkspaceKind | null {
  switch (role) {
    case "teller":
      return "teller";
    case "customer_service":
      return "customer_service";
    case "back_officer":
      return "back_officer";
    case "accountant":
      return "accountant";
    case "auditor":
      return "auditor";
    case "coordinator":
      return "operations";
    default:
      return null;
  }
}
