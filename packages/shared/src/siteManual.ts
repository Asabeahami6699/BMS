import type { TenantProductModule } from "./modules.js";

export type SiteManualDepartment =
  | "getting_started"
  | "susu"
  | "loans"
  | "banking"
  | "field_agent"
  | "settings"
  | "bridge";

export type SiteManualArticle = {
  id: string;
  department: SiteManualDepartment;
  title: string;
  howTo: string;
  keywords: string[];
  modules?: TenantProductModule[];
  requiresBridge?: boolean;
  body: string[];
};

export const SITE_MANUAL_DEPARTMENTS: {
  id: SiteManualDepartment;
  label: string;
  description: string;
}[] = [
  {
    id: "getting_started",
    label: "Getting started",
    description: "Sign-in, roles, and daily workspace basics."
  },
  {
    id: "susu",
    label: "Susu Management",
    description: "Collections, branch till, call-over, overages/shortages, and customer accounts."
  },
  {
    id: "loans",
    label: "Loans",
    description: "Products, applications, disbursement, and repayments."
  },
  {
    id: "bridge",
    label: "Susu ↔ Loans bridge",
    description: "Qualification, reserves, auto-debit, and passbook liens."
  },
  {
    id: "banking",
    label: "Banking / agency",
    description: "Teller, back office, withdrawals, and floats."
  },
  {
    id: "field_agent",
    label: "Field agent",
    description: "Mobile collection, registration, call-over, and alerts."
  },
  {
    id: "settings",
    label: "Settings",
    description: "Company profile, forms, SMS, and loan qualification setup."
  }
];

export const SITE_MANUAL_ARTICLES: SiteManualArticle[] = [
  {
    id: "gs-login",
    department: "getting_started",
    title: "Sign in to your company workspace",
    howTo: "How to sign in",
    keywords: ["login", "sign in", "password", "tenant"],
    body: [
      "Open your company subdomain or the platform login page.",
      "Enter the staff email and password issued by your admin.",
      "Field agents land in the mobile agent app; office roles land in the dashboard."
    ]
  },
  {
    id: "susu-collect",
    department: "susu",
    title: "Post a walk-in deposit at branch counter",
    howTo: "How to post a deposit",
    keywords: ["susu", "collection", "deposit", "branch counter", "teller"],
    modules: ["susu_management"],
    body: [
      "Open your till first (float + initial cash). Without an open till you cannot post cash.",
      "Go to Susu → Branch counter.",
      "Search and select the customer account.",
      "Choose Deposit only (Daily Susu is not posted on branch counter — use Field agent Collect and Callover).",
      "Enter the amount and post. Deposits increase physical cash in till and consume float capacity.",
      "Withdrawable balance already excludes savings minimum and any loan reserves."
    ]
  },
  {
    id: "susu-withdraw",
    department: "susu",
    title: "Pay a customer withdrawal",
    howTo: "How to withdraw from Susu",
    keywords: ["withdrawal", "withdraw", "susu", "branch counter", "cash"],
    modules: ["susu_management"],
    body: [
      "Select the customer on Branch counter.",
      "Check Withdrawable (not full account balance).",
      "Withdrawals need physical cash in the till — float alone is not cash. If cash is short, use Till movement → Extra cash (needs approval).",
      "Post a withdrawal only up to the withdrawable amount and available till cash.",
      "If a loan reserve or passbook lien is active, that amount cannot be withdrawn."
    ]
  },
  {
    id: "susu-till-open",
    department: "susu",
    title: "Open the branch till (float + initial cash)",
    howTo: "How to open till",
    keywords: ["till", "float", "open till", "initial cash", "day capital", "branch counter"],
    modules: ["susu_management"],
    body: [
      "On Branch counter, use Open till (or Till movement when the till is already open).",
      "Enter Initial float (deposit capacity) and Initial cash collected (physical notes in the drawer — may be GHS 0).",
      "Day capital = float + initial cash + any extra cash approved later. Float is not assumed to be cash.",
      "Teller requests wait for admin or coordinator approval. Admin/coordinator can also use Susu → Till float → Push & open till (popup) to push float + cash with no request.",
      "When the till is open, use Till movement on the till header for extra float, extra cash, or expenses."
    ]
  },
  {
    id: "susu-till-movement",
    department: "susu",
    title: "Till movement: extra float, extra cash, expense",
    howTo: "How to use till movement",
    keywords: ["till movement", "extra float", "extra cash", "expense", "approve", "petty cash"],
    modules: ["susu_management"],
    body: [
      "With an open till, click Till movement on the till header.",
      "Extra float: request more deposit capacity when float is used up. Adds to day capital after approval (not physical cash).",
      "Extra cash: collect vault/coordinator cash when withdrawals need more than drawer cash. Adds to day capital and cash in till after approval.",
      "Expense: record petty cash paid from the drawer. Deducted from expected cash so end-of-day can balance. Needs a reason and approval for teller requests.",
      "Admin and coordinator can approve pending movements from Branch counter or Susu → Till float, or apply movements immediately themselves."
    ]
  },
  {
    id: "susu-till-eod",
    department: "susu",
    title: "End-of-day till balancing",
    howTo: "How to close and balance the till",
    keywords: ["close till", "balance", "expected cash", "variance", "eod", "end of day"],
    modules: ["susu_management"],
    body: [
      "Expected cash in till = initial cash + extra cash + deposits − withdrawals − expenses. Day capital is not what you count.",
      "Count physical cash in the drawer and enter Actual cash counted. The screen flags Balanced, Overage, or Shortage automatically as you type.",
      "Close till. Non-zero variance opens a Branch till case on Overages/Shortages automatically (separate from field agent cases). A note is required for overage or shortage.",
      "Admin/coordinator settles the closed float session and reconciles any till overage/shortage on the OS page."
    ]
  },
  {
    id: "susu-overages-shortages",
    department: "susu",
    title: "Overages and shortages (field agent vs branch till)",
    howTo: "How to manage overages and shortages",
    keywords: ["overage", "shortage", "os", "variance", "callover", "teller till"],
    modules: ["susu_management"],
    body: [
      "Go to Susu → Overages/Shortages.",
      "The page has two separate sections: Field agents (callover) and Branch till (teller EOD). Cases never mix.",
      "Field agents: shortages are agent debt; overages can credit a customer.",
      "Branch till: shortages are teller debt; overages are excess drawer cash to reconcile.",
      "Never offset a shortage against an overage, and never settle a till case against a field agent case."
    ]
  },
  {
    id: "susu-closing-balances",
    department: "susu",
    title: "Branch vault closing balances",
    howTo: "How to close the branch vault",
    keywords: [
      "closing balances",
      "vault",
      "safe",
      "cash to bank",
      "opening vault",
      "till",
      "field agent",
      "branch worksheet"
    ],
    modules: ["susu_management"],
    body: [
      "Go to Susu → Closing balances. Pick branch and business date.",
      "Opening vault auto-fills from yesterday’s close (vault counted if saved, otherwise expected closing vault). Admin/coordinator may adjust — the difference is notified.",
      "Tills: cash issued = initial + extra cash (not float). Closed tills return to vault; open tills show as still in drawers.",
      "Field deposits increase the vault; field withdrawals decrease it. Walk-in activity stays inside till cash.",
      "Enter cash to bank (Susu worksheet only — Banking Treasury post comes later), optional vault count, and save.",
      "Expected closing vault = opening − issued to tills + field deposits − field withdrawals + returned closed tills − cash to bank − extra branch expenses.",
      "Teller drawer OS remains on Overages/Shortages → Branch till."
    ]
  },
  {
    id: "loans-apply",
    department: "loans",
    title: "Create a loan application",
    howTo: "How to apply for a loan",
    keywords: ["loan", "application", "apply", "product"],
    modules: ["loans_credit"],
    body: [
      "Open Loans → Apply (individual or group).",
      "Pick the customer (or group), product, and amount.",
      "When the Susu↔Loans bridge is on, the system stores a Susu credit snapshot for qualification.",
      "Submit for approval, then disburse when approved."
    ]
  },
  {
    id: "loans-disburse-susu",
    department: "bridge",
    title: "Disburse a loan into the Susu account",
    howTo: "How to disburse to Susu",
    keywords: ["disburse", "susu", "credit", "branch counter", "withdraw"],
    modules: ["loans_credit", "susu_management"],
    requiresBridge: true,
    body: [
      "With the bridge enabled, disbursement credits the loan principal to the customer's Susu/savings ledger.",
      "The customer (or teller) can then withdraw the funds from Branch counter like a normal Susu balance.",
      "First installment reserve and any passbook lien still reduce withdrawable where configured."
    ]
  },
  {
    id: "bridge-qualification",
    department: "bridge",
    title: "Loan qualification badge and SMS",
    howTo: "How to set loan qualification",
    keywords: [
      "qualify",
      "qualification",
      "badge",
      "sms",
      "consistency",
      "months",
      "thresholds",
      "susu days",
      "account balance",
      "susu total"
    ],
    modules: ["loans_credit", "susu_management"],
    requiresBridge: true,
    body: [
      "Go to Settings → Loan qualification (Susu↔Loans bridge must be on).",
      "Consistency period (1, 3, or 6 months) is the lookback window. Only Susu activity inside that window counts.",
      "Threshold 1 — Minimum Susu days: how many separate days the customer must have a daily Susu collection. Example: 15 means at least 15 Susu collection days in the period.",
      "Threshold 2 — Minimum account balance: the customer’s current Susu/savings ledger balance must be at least this amount when the scan runs. Example: GHS 100 means they still have GHS 100+ on the account today.",
      "Threshold 3 — Minimum Susu total: the sum of daily Susu collections in the period must reach this amount. Example: GHS 200 means those collections add up to at least GHS 200, even if some money was later withdrawn.",
      "All three thresholds must pass. Missing any one means no Loan ready badge.",
      "Customers who pass show the badge on their account. If SMS on qualify is enabled, they get a one-time message when they newly qualify."
    ]
  },
  {
    id: "bridge-qualification-thresholds",
    department: "bridge",
    title: "Understanding Susu days, balance, and Susu total",
    howTo: "How to understand qualification thresholds",
    keywords: [
      "minimum susu days",
      "minimum account balance",
      "minimum susu total",
      "threshold",
      "explain",
      "qualification",
      "what does it mean"
    ],
    modules: ["loans_credit", "susu_management"],
    requiresBridge: true,
    body: [
      "These three numbers work together. The customer must satisfy every one inside your chosen period.",
      "Minimum Susu days measures consistency (showing up), not how much money moved. Ten deposits on one day still count as one Susu day.",
      "Minimum account balance measures money still on the account right now. High past deposits do not help if the balance is low today.",
      "Minimum Susu total measures how much was collected as daily Susu during the period. Withdrawals do not erase that history for this check.",
      "Simple story: days = regular saver, balance = still has funds, total = contributed enough over the period.",
      "Change the period if your company wants a shorter trial (1 month) or a longer track record (6 months)."
    ]
  },
  {
    id: "bridge-lien",
    department: "bridge",
    title: "Passbook lien (savings-secured loan)",
    howTo: "How passbook collateral works",
    keywords: ["lien", "collateral", "locked", "passbook", "secured"],
    modules: ["loans_credit", "susu_management"],
    requiresBridge: true,
    body: [
      "In Loan qualification setup, set Collateral % of Susu balance.",
      "On disbursement the system locks that share as loan collateral (separate from savings opening minimum).",
      "Locked collateral cannot be withdrawn until the loan is closed.",
      "Next-installment reserve still applies on top for the upcoming repayment."
    ]
  },
  {
    id: "bridge-autodebit",
    department: "bridge",
    title: "Auto-debit and missed payment recovery",
    howTo: "How Susu auto-debit recovery works",
    keywords: ["auto debit", "recovery", "retry", "par", "overdue", "sms"],
    modules: ["loans_credit", "susu_management"],
    requiresBridge: true,
    body: [
      "When an installment is due, the system tries to debit Susu automatically.",
      "If it fails: retry the next day → SMS the customer → create an agent task → escalate PAR to staff.",
      "Successful Susu repayments appear on the loan schedule with source From Susu account."
    ]
  },
  {
    id: "agent-collect",
    department: "field_agent",
    title: "Field agent daily collection",
    howTo: "How field agents collect",
    keywords: ["field agent", "collect", "offline", "sync", "daily susu"],
    modules: ["susu_management"],
    body: [
      "Open the Field agent app → Collect.",
      "Select the customer, enter the daily Susu amount, and save. (Branch counter does not post Daily Susu.)",
      "Offline collections queue and sync when the phone is online.",
      "Use Call over to submit the day's batch for coordinator approval and posting."
    ]
  },
  {
    id: "settings-sms",
    department: "settings",
    title: "Turn on customer SMS alerts",
    howTo: "How to configure SMS",
    keywords: ["sms", "arkesel", "sender id", "notifications"],
    body: [
      "Settings → Notification Settings.",
      "Enable SMS and choose deposit, withdrawal, and daily Susu events.",
      "Sender ID must be Arkesel-approved before messages deliver.",
      "Loan qualification and lifecycle warnings also use this channel when enabled."
    ]
  },
  {
    id: "banking-teller",
    department: "banking",
    title: "Teller and back-office cash flow",
    howTo: "How to use teller desks",
    keywords: ["teller", "back office", "float", "deposit"],
    modules: ["banking"],
    body: [
      "Use Banking role desks for teller till, deposits, and reconciliations.",
      "For Susu branch counter, open the till with float (capacity) plus initial cash (physical notes). Extra float, extra cash, and expenses go through Till movement with admin/coordinator approval.",
      "End-of-day balances physical expected cash, not day capital. Till variances appear under Overages/Shortages → Branch till.",
      "Back office handles bank execution and balancing entries."
    ]
  }
];

export function filterSiteManualArticles(input: {
  modules?: TenantProductModule[];
  bridgeActive?: boolean;
  query?: string;
}): SiteManualArticle[] {
  const q = input.query?.trim().toLowerCase() ?? "";
  const modules = new Set(input.modules ?? []);
  return SITE_MANUAL_ARTICLES.filter((article) => {
    if (article.requiresBridge && !input.bridgeActive) {
      return false;
    }
    if (article.modules?.length) {
      const ok = article.modules.every((m) => modules.has(m));
      if (!ok) {
        return false;
      }
    }
    if (!q) {
      return true;
    }
    const hay = [
      article.title,
      article.howTo,
      ...article.keywords,
      ...article.body,
      article.department
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}
