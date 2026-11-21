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
    description:
      "Onboarding, Susu passbook, daily collections, call-over, reversals, cycle fees, Susu income, branch counter, tills, withdrawals, vault close, and team operations."
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
    id: "susu-onboarding-accounts",
    department: "susu",
    title: "Customer onboarding, account types, and pending approvals",
    howTo: "How to register and approve Susu customers",
    keywords: [
      "susu",
      "onboarding",
      "register",
      "customer",
      "pending approvals",
      "account type",
      "savings",
      "daily contribution",
      "meba daakye",
      "activation"
    ],
    modules: ["susu_management"],
    body: [
      "New customers can be registered in the office under Susu → Customer Onboarding or in the field via the Field agent mobile app.",
      "Supported account types include Susu, Savings (which can carry an opening fee and minimum locked balance), Group, and Meba Daakye.",
      "Set the customer’s agreed daily contribution amount during onboarding (for example GHS 20/day). The Susu passbook and first-day Susu cycle fee both use this registered daily plan.",
      "Every new registration lands in Susu → Pending Approvals. Admin or coordinator verifies the customer details, confirms the registration phone number, and approves or rejects the account.",
      "Once approved, the account becomes Active, receives an account number, and appears in Susu → Customers for deposits, collections, statements, and passbook tracking."
    ]
  },
  {
    id: "susu-passbook",
    department: "susu",
    title: "Susu passbook (virtual 31-box contribution pages) & account statements",
    howTo: "How the Susu passbook works",
    keywords: [
      "susu passbook",
      "passbook",
      "page",
      "pages",
      "boxes",
      "31",
      "checked boxes",
      "partial",
      "overflow",
      "page switcher",
      "statement",
      "account statement",
      "pdf",
      "csv"
    ],
    modules: ["susu_management"],
    body: [
      "Every Susu account includes a virtual Susu passbook showing its contribution boxes (dynamic to your company’s cycle length, e.g. 31 boxes per page).",
      "Where to find it: open any Susu customer’s Account statement (Susu → Customers → Actions → Account statement), open Customer Details, or tap Susu passbook on an active Susu customer card in the Field agent app.",
      "Automatic box counting (1 real ledger transaction): both Field agent Daily Susu collections (posted via Callover) and walk-in Branch counter deposits on Susu accounts convert into checked boxes using gross contribution ÷ daily contribution plan. Example: on a GHS 20/day plan, a GHS 100 payment records 1 transaction and auto-checks 5 boxes (Box 1 = institution Fee, Boxes 2–5 = customer savings). A later GHS 60 payment auto-checks Boxes 6, 7, and 8. Loan disbursements credited via the Susu↔Loans bridge are excluded so they never distort passbook boxes.",
      "Partial boxes (non-multiples): if a customer pays GHS 30 on a GHS 20 plan, 1 full box checks off and the next box shows a progress fill of 10 / 20 (partial) until the remaining GHS 10 is paid.",
      "Overflow into the next page: if a customer is at Box 29 (28 boxes filled) and pays GHS 100 (5 boxes), Boxes 29, 30, and 31 complete Page #1 (marked Completed) and the remaining GHS 40 automatically opens Page #2 and checks Boxes 1 and 2 (collecting Page #2’s Box 1 fee if first-collection timing is enabled).",
      "Visual cues: Box 1 is badged Fee under first-collection timing (or the final box, e.g. Box 31, under cycle-maturity timing). Checked boxes show a green tick, date, and amount; partial boxes show a progress bar.",
      "Page switcher: use Page #1, Page #2, etc. at the top of the Susu passbook to inspect past completed pages as well as the current active page.",
      "Account statements also let staff filter by date range, print a PDF statement, or download the full ledger as CSV."
    ]
  },
  {
    id: "susu-callover-batches",
    department: "susu",
    title: "Callover batches (reviewing and posting field agent daily Susu)",
    howTo: "How to approve callover batches",
    keywords: [
      "callover",
      "call over",
      "batch",
      "daily susu",
      "field agent",
      "coordinator",
      "post",
      "collections",
      "cash handover"
    ],
    modules: ["susu_management"],
    body: [
      "Field agents collect Daily Susu in the mobile app and submit their batch via Call over (Daily Susu is not posted directly at Branch counter).",
      "Go to Susu → Callover batches to review pending agent submissions for your branch.",
      "Count the physical cash handed over by the agent and compare it against the batch total.",
      "Approve and post the batch: each customer’s account is credited, their Susu passbook boxes check off automatically, Susu cycle commission is applied per policy, and customer SMS receipts fire if enabled.",
      "If physical cash handed over differs from the submitted batch total, the difference automatically creates a Field agent case under Susu → Overages/Shortages."
    ]
  },
  {
    id: "susu-reversal",
    department: "susu",
    title: "Reversing a Daily Susu collection (and unchecking passbook boxes)",
    howTo: "How to reverse a Susu collection",
    keywords: [
      "reverse",
      "reversal",
      "undo",
      "mistake",
      "wrong amount",
      "uncheck",
      "passbook",
      "daily susu"
    ],
    modules: ["susu_management"],
    body: [
      "If a posted Daily Susu collection had the wrong amount or customer, authorized staff can reverse it from Susu → Customers → open customer details → find the Daily Susu entry in the ledger → Reverse.",
      "Enter a clear reason for the reversal. The system posts an auditable reversal entry rather than deleting history.",
      "Reversing a Daily Susu transaction automatically reverses any institutional Susu commission tied to it and unchecks the exact boxes that payment filled on the customer’s Susu passbook.",
      "If the reversed payment had overflowed into a new page (e.g. Page #2), the passbook rolls back cleanly to the prior open page."
    ]
  },
  {
    id: "susu-cycle-commission",
    department: "susu",
    title: "Susu cycle fees (institutional commission setup)",
    howTo: "How to configure Susu cycle fees",
    keywords: [
      "susu cycle fees",
      "cycle commission",
      "commission",
      "first day",
      "maturity",
      "withdrawal fee",
      "31 days",
      "fee box",
      "early withdrawal",
      "rollover",
      "policy"
    ],
    modules: ["susu_management"],
    body: [
      "Go to Susu → Susu cycle fees to configure how your institution earns Susu commission on customer cycles.",
      "Cycle length: choose the number of contribution boxes per page (standard Susu is 31 days/boxes).",
      "Commission basis: pick Customer’s registered daily amount (1 day’s contribution — e.g. GHS 20 on a GHS 20 plan), a Fixed amount for everyone, a Percentage of total cycle contributions, or No commission.",
      "Deduction timing: choose First collection(s) (deducted upfront on Box 1 so customer savings ledger receives the net credit while the passbook tracks full gross boxes), Cycle maturity (deducted when the page completes at Box 31), or Customer withdrawal (deducted when the customer withdraws).",
      "Partial-payment allocation (for first-collection timing): decide whether an underpayment satisfies Commission first, Savings first, or Proportional.",
      "Early withdrawal policy: choose whether withdrawing before a page matures will Deduct full fee, Deduct pro-rata (based on contribution boxes completed), Waive the fee, or Block early withdrawal.",
      "Changes apply cleanly as a versioned policy; earned commission posts automatically to Susu → Susu income."
    ]
  },
  {
    id: "susu-income",
    department: "susu",
    title: "Susu income (company fee revenue by branch)",
    howTo: "How to track Susu fee income",
    keywords: [
      "susu income",
      "institutional income",
      "fee income",
      "revenue",
      "opening fee",
      "savings opening fee",
      "cycle commission",
      "branch income",
      "backfill"
    ],
    modules: ["susu_management"],
    body: [
      "Go to Susu → Susu income to view institutional fee revenue earned by your company (strictly isolated to your tenant’s branches and never mixed with customer deposits).",
      "Two automatic income streams are tracked: Susu cycle fees (earned from customer Susu cycles) and Savings opening fees (recorded for the branch when new savings accounts activate).",
      "Filter by branch, date range, and income source to review daily or period totals, branch breakdowns, and any reversed fee entries.",
      "Note: Susu income tracks revenue earned by the institution from customer fees. Staff payroll commissions paid to field agents are managed separately under Susu → Agent commissions."
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
      "Enter the amount and post. Deposits increase physical cash in till (by the full gross cash received, even if Susu Box 1 commission applies) and consume float capacity.",
      "For Susu accounts, walk-in counter deposits also check off boxes on the customer’s Susu passbook and apply your Susu cycle fee policy automatically so the passbook stays aligned with contributions.",
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
      "If your Susu cycle fee timing is set to Withdrawal (or an early-withdrawal fee applies), the system evaluates the active Susu cycle automatically.",
      "If a savings opening minimum, loan reserve, or passbook lien is active, that locked amount cannot be withdrawn."
    ]
  },
  {
    id: "susu-withdrawal-gate-momo",
    department: "susu",
    title: "Withdrawal gate (MoMo & remote withdrawal approvals)",
    howTo: "How to approve MoMo withdrawals",
    keywords: ["withdrawal gate", "momo", "mobile money", "payout", "customer service", "proof"],
    modules: ["susu_management"],
    body: [
      "Go to Susu → Withdrawal gate to review pending MoMo withdrawal requests.",
      "Verify the customer’s available withdrawable balance, phone number, and payout details before approving.",
      "MoMo payouts are settled outside the branch cash till with payout proof/reference recorded on the request.",
      "Remote field-agent cash withdrawals follow the separate Coordinator → Branch counter (Pay now) flow so physical drawer cash stays accurate."
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
    id: "susu-group-savings",
    department: "susu",
    title: "Group Savings accounts",
    howTo: "How to manage Group Savings",
    keywords: ["group savings", "group", "members", "susu", "collective"],
    modules: ["susu_management"],
    body: [
      "Go to Susu → Group Savings to create and manage group savings accounts and member rosters.",
      "Track group contributions, member participation, and balances in one place.",
      "When Loans is also enabled, eligible groups can apply for group loans directly from Loans → Apply."
    ]
  },
  {
    id: "susu-routes-team",
    department: "susu",
    title: "Routes, field agents, and coordinators",
    howTo: "How to organize Susu routes and staff",
    keywords: ["routes", "agents", "field agents", "coordinators", "territory", "assign"],
    modules: ["susu_management"],
    body: [
      "Go to Susu → Routes to define collection routes/zones and assign field agents to territories.",
      "Use Susu → Agents to view your field agent roster, branch assignment, active customers, and collection activity.",
      "Use Susu → Coordinators (admin) to oversee coordinator accounts and branch approval workloads."
    ]
  },
  {
    id: "susu-agent-commissions-payroll",
    department: "susu",
    title: "Agent commissions, payroll, and Susu performance",
    howTo: "How agent commissions and payroll work",
    keywords: [
      "agent commissions",
      "payroll",
      "performance",
      "leaderboard",
      "kpi",
      "staff commission",
      "salary"
    ],
    modules: ["susu_management"],
    body: [
      "Susu → Agent commissions configures payroll commission rates paid to field agents and coordinators based on collections (separate from company revenue in Susu → Susu cycle fees and Susu → Susu income).",
      "Susu → Payroll lets admins and accountants prepare and review staff payroll runs incorporating earned commissions.",
      "Susu → Performance provides read-only KPIs and leaderboards showing branch and agent collection volume, active savers, and growth."
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
    title: "Field agent daily collection & Susu passbook",
    howTo: "How field agents collect",
    keywords: ["field agent", "collect", "offline", "sync", "daily susu", "passbook", "susu passbook"],
    modules: ["susu_management"],
    body: [
      "Open the Field agent app → Collect.",
      "Select the customer, enter the daily Susu amount (single day, multi-day, or partial payment), and save. (Branch counter does not post Daily Susu.)",
      "Offline collections queue on the device and sync automatically when the phone is back online.",
      "Use Call over to submit the day's batch for coordinator approval and posting.",
      "Tap Susu passbook on any active Susu customer card under Customers to show the customer their checked boxes, partial progress, Fee box, and past completed pages."
    ]
  },
  {
    id: "agent-withdrawal-pay-now",
    department: "susu",
    title: "Field agent cash withdrawal (Pay now)",
    howTo: "How remote customer cash withdrawals work",
    keywords: [
      "withdrawal",
      "pay now",
      "field agent",
      "teller",
      "coordinator",
      "registration phone"
    ],
    modules: ["susu_management"],
    body: [
      "Field agent requests cash withdrawal (customer is far from the office; agent will deliver next visit).",
      "Coordinator reviews the request, calls the customer on the registration phone, then Approves.",
      "Customer Service is not in the field-agent cash path (agency walk-in withdrawals still use CS → teller).",
      "Approve does not debit the account and does not move vault cash — it queues Branch counter → Pay now.",
      "Teller opens till with enough physical cash (use Extra cash from vault if needed), then Pay now.",
      "Pay now debits the customer and reduces till cash (shown separately from walk-in withdrawals on EOD).",
      "Agent collects the cash from the office and delivers on the next visit.",
      "MoMo stays separate: coordinator pays outside the till with proof.",
      "Vault closing does not count Pay now again as a field withdrawal — cash already left via cash issued to till."
    ]
  },
  {
    id: "susu-till-eod-split",
    department: "susu",
    title: "Teller expected cash (walk-in vs field Pay now)",
    howTo: "How till EOD splits withdrawals",
    keywords: ["till", "eod", "walk-in", "field withdrawal", "pay now"],
    modules: ["susu_management"],
    body: [
      "Expected cash = initial cash + extra cash + deposits − walk-in withdrawals − field Pay now − expenses.",
      "Both withdrawal lines leave the same drawer; the split is for clarity only.",
      "Count physical cash once and close the till. Variance opens a Branch till OS case."
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
