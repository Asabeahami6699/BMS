const iconByLabel: Record<string, string> = {
  Dashboard: "◫",
  Overview: "◫",
  "Reports & Analytics": "▤",
  Settings: "⚙",
  Banking: "🏦",
  "Agency Banking": "🏦",
  "Susu Management": "◎",
  Loans: "◈",
  Treasury: "◇",
  Companies: "🏢",
  "Subscription Management": "💳",
  "Product Subscription": "💳",
  Products: "📦",
  "Add-ons": "➕",
  "Live chat": "💬",
  "Company chats": "💬"
};

const iconByPath: Record<string, string> = {
  dashboard: "◫",
  "banking/teller": "₵",
  "banking/deposits": "↓",
  "banking/reconciliation": "≡",
  "banking/till-daybook": "📒",
  "banking/customer-service": "☎",
  "banking/withdrawals": "✓",
  "banking/account-opening": "✚",
  "banking/back-office": "🏦",
  "banking/accountant": "📊",
  "banking/auditor": "🔍",
  "banking/hrm": "👥",
  "banking/operations": "⌂",
  overview: "◫",
  "susu/overview": "◫",
  reports: "▤",
  profile: "👤",
  "susu/customers": "◎",
  "susu/pending-approvals": "◷",
  "susu/callover-batches": "✓",
  "susu/till-float": "💵",
  "susu/collections": "₵",
  "susu/agents": "🚶",
  "susu/coordinators": "👥",
  "susu/routes": "↝",
  "susu/commissions": "%",
  "susu/payroll": "🧾",
  "susu/withdrawals": "↓",
  "susu/group-savings": "⊕",
  "susu/performance": "▲",
  "susu/onboarding": "✚",
  banking: "🏦",
  loans: "◈",
  treasury: "◇",
  "settings/profile": "🏢",
  "settings/branches": "⌂",
  "settings/account-numbers": "#",
  "settings/subscription": "💳",
  "settings/users": "👤",
  "settings/roles": "⚙",
  "settings/approval-workflows": "✓",
  "settings/notifications": "🔔",
  "settings/audit-logs": "📋"
};

export function getNavIcon(label: string, path?: string): string {
  if (path) {
    const key = path.replace(/^\/+/, "").replace(/^app\//, "");
    if (iconByPath[key]) {
      return iconByPath[key];
    }
  }
  return iconByLabel[label] ?? "•";
}
