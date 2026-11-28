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
    title: "Sign in to your company workspace (white-label subdomain & PWA)",
    howTo: "How to sign in",
    keywords: [
      "login",
      "sign in",
      "password",
      "tenant",
      "subdomain",
      "white label",
      "branding",
      "logo",
      "pwa",
      "install"
    ],
    body: [
      "Open your company subdomain (e.g. yourcompany.aabanker.com). The login screen, browser tab title, favicon, sidebar, customer receipts/cards, and installable mobile/desktop app icon (PWA) automatically display your company’s name, logo, and brand color configured under Settings → Organization.",
      "The root platform host (aabanker.com) remains branded as aabanker for platform administration.",
      "Enter the staff email and password issued by your admin.",
      "Field agents land in the mobile agent app; office roles land in the dashboard."
    ]
  },
  {
    id: "susu-onboarding-accounts",
    department: "susu",
    title: "Customer onboarding, Savings initial deposit, Simplified KYC, editing & rejected registrations",
    howTo: "How to register, approve, edit, or send back rejected registrations",
    keywords: [
      "susu",
      "onboarding",
      "register",
      "customer",
      "pending approvals",
      "rejected",
      "send back",
      "mobilizer",
      "resubmit",
      "fix and resubmit",
      "update details",
      "edit customer",
      "account type",
      "savings",
      "initial deposit",
      "locked balance",
      "opening fee",
      "daily contribution",
      "meba daakye",
      "activation",
      "id card",
      "ghana card",
      "voters id",
      "nhis",
      "health insurance",
      "drivers licence",
      "passport",
      "non-citizen",
      "ecowas",
      "foreigner",
      "simplified kyc",
      "tier 1",
      "introducer",
      "upgrade kyc"
    ],
    modules: ["susu_management"],
    body: [
      "New customers can be registered in the office under Susu → Customer Onboarding or in the field via the Field agent mobile app.",
      "Supported account types include Susu, Savings, Group, and Meba Daakye. Daily contribution amount is captured for Susu / Group / Meba Daakye accounts only and is automatically hidden on Normal Savings accounts.",
      "Normal Savings initial deposit & locked minimum balance: Savings registrations require an Initial deposit at least equal to your company’s configured locked minimum balance (e.g. GHS 20). On coordinator approval, the full initial deposit is credited to the customer’s Savings account, the minimum balance is locked automatically per your commission timing policy (keeping only the excess withdrawable), and the customer receives two ordered SMS/email alerts — Account Approved first, followed by Deposit Confirmed.",
      "Supported ID card types under Identity & KYC: Ghana Card, Non-Citizen Ghana Card, ECOWAS National ID, Voter's ID, Health Insurance (NHIS), Driver's Licence, Passport, and No National ID (Tier 1 · Simplified KYC + Local Introducer).",
      "Tier 1 · Simplified KYC (BoG-aligned onboarding for foreign residents or applicants without a national ID): selecting No National ID requires the customer’s Nationality (grouped West Africa / global dropdown), a mandatory live Customer Face Photo, and a verified Local Introducer (full name, phone, relationship, and valid Ghana Card number).",
      "Tier 1 · Simplified KYC guardrails: accounts are tagged Simplified KYC, capped at the tenant’s configured maximum balance (default GHS 5,000, configurable in Settings → Form setup), and locked from Loans and Investments until upgraded. By default, Simplified KYC customers withdraw in person at the branch with face verification, or the admin can toggle Allow field agent withdrawal requests in Settings → Form setup.",
      "Upgrade to Full KYC: once a Simplified KYC customer obtains a Non-Citizen Ghana Card, ECOWAS ID, Passport, or other approved ID, an admin, branch manager, or coordinator opens the customer’s profile and clicks Upgrade to Full KYC to lift Tier 1 limits (logged in Audit logs).",
      "Approved Customers vs Pending & Rejected registrations: Susu → Customers lists approved accounts only (Active, Inactive, Dormant, Suspended, Closed). Pending and rejected registrations stay under Susu → Pending Approvals (separate Registrations and Rejected registrations tabs) and Susu → Customer Onboarding so unapproved sign-ups never mix into approved customers.",
      "Sending rejected accounts back to the mobilizer: open Susu → Pending Approvals → Rejected registrations (or Customer Onboarding) and click Send back to mobilizer with clear instructions on what to fix. The mobilizer receives an alert and taps Fix & resubmit on their Customers or Registrations screen to edit all saved fields/photos and resubmit the exact same record back to Pending Approvals (no duplicate customer created).",
      "Updating customer details: authorized office staff (Admin, Coordinator, Customer Service) can click Update details from a customer’s row menu or detail modal to correct profile, contact, address, ID, next-of-kin, or branch details — every change is recorded with before/after values in Audit logs."
    ]
  },
  {
    id: "susu-passbook",
    department: "susu",
    title: "Susu passbook (virtual 31-box cards, BBF, cancelled pages & rate changes)",
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
      "bbf",
      "balance brought forward",
      "cancelled page",
      "red line",
      "daily rate",
      "page switcher",
      "statement",
      "account statement",
      "pdf",
      "csv"
    ],
    modules: ["susu_management"],
    body: [
      "Every Susu account includes a virtual Susu passbook showing its contribution boxes (dynamic to your company’s cycle length, e.g. 31 boxes per page).",
      "Where to find it: open Susu → Account statements from the sidebar (available to all authorised roles), open any Susu customer’s Account statement from Susu → Customers, open Customer Details, or tap Susu passbook on an active Susu customer card in the Field agent app.",
      "Automatic box counting (1 real ledger transaction): both Field agent Daily Susu collections (posted via Callover) and walk-in Branch counter deposits on Susu accounts convert into checked boxes using gross contribution ÷ daily contribution plan. Example: on a GHS 20/day plan, a GHS 100 payment records 1 transaction and auto-checks 5 boxes (Box 1 = institution Fee, Boxes 2–5 = customer savings). Loan disbursements and non-contribution adjustments are excluded so passbook boxes always stay ledger-accurate.",
      "Partial boxes (non-multiples): if a customer pays GHS 30 on a GHS 20 plan, 1 full box checks off and the next box shows a progress fill of 10 / 20 (partial) until the remaining GHS 10 is paid.",
      "Overflow into the next page: if a customer is at Box 29 (28 boxes filled) and pays GHS 100 (5 boxes), Boxes 29, 30, and 31 complete Page #1 (marked Completed) and the remaining GHS 40 automatically opens Page #2 and checks Boxes 1 and 2 (collecting Page #2’s Box 1 fee if first-collection timing is enabled).",
      "Cancelled pages & Balance Brought Forward (BBF): when a customer withdraws from a completed page (e.g. withdrawing GHS 200 from a GHS 600 completed Page #1), Page #1 is immediately marked Cancelled with a red strike-through line (matching real-world Susu book practice) and the leftover GHS 400 rolls forward as Balance Brought Forward (BBF) at the top of Page #2. BBF never auto-checks contribution boxes — Page #2 still starts at 0/31 boxes — and BBF is always spent first on future withdrawals with GHS 0 additional fee.",
      "Scheduled daily contribution changes (Susu only): admins can update a Susu customer’s daily rate from Customer Details. The new rate is scheduled automatically for the next card so the current active page finishes cleanly at its original rate.",
      "Visual cues & page switcher: Box 1 is badged Fee under first-collection timing (or the final box, e.g. Box 31, under cycle-maturity timing). Use Page #1, Page #2, etc. at the top of the passbook to inspect active, completed, and red-line cancelled pages.",
      "Account statements & passbook workspace (Susu → Account statements): authorised staff can search any customer by name, account number, phone, branch, or account type; view live KPIs (current balance, period credits/debits); switch between Passbook & Ledger, Account ledger, and Susu passbook; filter by 7D/30D/90D/All time or custom dates; print an official PDF statement; print a visual 31-box Passbook Card; share a formatted account summary via WhatsApp/clipboard; or export CSV."
    ]
  },
  {
    id: "susu-callover-batches",
    department: "susu",
    title: "Callover batches (posting, removing mistaken lines, canceling unposted batches & Batch #2+)",
    howTo: "How to review, clean up, unlock extra batches, and post callover batches",
    keywords: [
      "callover",
      "call over",
      "batch",
      "batch 2",
      "extra batch",
      "unlock extra",
      "cancel batch",
      "remove line",
      "duplicate",
      "daily susu",
      "field agent",
      "coordinator",
      "post",
      "collections",
      "cash handover",
      "overdue",
      "prior day"
    ],
    modules: ["susu_management"],
    body: [
      "Field agents collect Daily Susu in the mobile app and submit their batch via Call over (Daily Susu is not posted directly at Branch counter).",
      "Go to Susu → Callover batches to review pending agent submissions for your branch.",
      "Overdue batch guard: any submitted batch from an earlier date that was not posted yet is automatically pinned at the top of the queue with an Overdue badge so it is never hidden behind today’s date.",
      "If a field agent forgot to submit yesterday’s draft collections, their Field agent Home screen highlights the overdue batch with a 1-tap Submit button so they can send it without losing a single collection.",
      "Removing a mistaken line or canceling an unposted batch: while a batch is still pending (unposted), no customer has been credited and no customer SMS/email has fired. Click View lines → Remove on an individual duplicate/mistaken line (with a required audit reason) to drop just that line and recalculate the batch total — or click Cancel batch to discard the entire unposted batch so the agent can start fresh. Removing the only line in a batch automatically cancels the empty unposted batch. Already-posted batches cannot be canceled or edited (use ledger Reversal for posted errors).",
      "Count the physical cash handed over by the agent and compare it against the batch total.",
      "Approve and post the batch: each customer’s account is credited, their Susu passbook boxes check off automatically, Susu cycle commission is applied per policy, and customer SMS receipts fire if enabled.",
      "If physical cash handed over differs from the submitted batch total, the difference automatically creates a Field agent case under Susu → Overages/Shortages.",
      "Coordinator-unlocked extra batches (Batch #2+): if a field agent accidentally submitted and posted call-over early in the day, scroll to Posted batches on Susu → Callover batches and click Allow extra batch (Batch #2) with a required audit reason. Batch #1 stays locked and audited, the agent can continue collecting into Batch #2 and submit it separately, and today’s combined totals add up automatically."
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
    title: "Susu cycle fees & FIFO withdrawal deduction rules",
    howTo: "How to configure Susu cycle fees",
    keywords: [
      "susu cycle fees",
      "cycle commission",
      "commission",
      "first day",
      "maturity",
      "withdrawal fee",
      "fifo",
      "bbf",
      "red line",
      "31 days",
      "fee box",
      "early withdrawal",
      "rollover",
      "policy"
    ],
    modules: ["susu_management"],
    body: [
      "Go to Susu → Susu cycle fees to configure how your institution earns Susu commission on customer cycles. Click How deductions work at the top of that page anytime for a worked staff reference.",
      "Cycle length & basis: choose the contribution boxes per page (standard Susu is 31 days) and commission basis (Customer’s registered daily amount, Fixed amount, Percentage, or No commission).",
      "Deduction timing: choose First collection(s) (deducted upfront on Box 1), Cycle maturity (deducted when the page completes at Box 31), or Customer withdrawal (deducted when the customer withdraws).",
      "Safe timing switches (zero double-deduction): policies are versioned and snapshotted when each card opens. Switching from First collection(s) to Customer withdrawal applies immediately to new/next cards while never double-charging any existing card whose fee was already collected (withdrawals strictly check remaining unpaid commissionOutstanding).",
      "Customer commission notification toggle: under When to deduct, toggle Send message to customer when commission is deducted ON (default) to send an SMS/email alert whenever Susu commission is deducted, or turn it OFF to deduct silently without sending a separate commission message.",
      "Separate commission ledger & SMS sequence: both deposit and withdrawal Susu commissions post as their own system Debit (commission) row on customer statements and ledgers. When commission alerts are ON during a withdrawal, SMS #1 confirms the exact cash withdrawn and balance before fee, followed by SMS #2 confirming the Susu service charge and remaining balance.",
      "Strict FIFO withdrawal settlement: every Susu withdrawal settles in strict oldest-first order — (1) Balance Brought Forward (BBF) first at GHS 0 fee, (2) Completed pages oldest-first (any touched completed page is cancelled with a red line, its remaining fee if any is collected, and any leftover rolls forward as BBF onto the next page), and (3) Active incomplete page last only if the withdrawal overflows past BBF and all completed pages.",
      "Commission charged on top: when a withdrawal triggers a Susu fee, the fee is charged on top of the customer’s requested amount so the customer receives their full requested payout (unless total available balance cannot cover both, in which case remaining balance is settled cleanly).",
      "Early withdrawal policy (when touching an incomplete page): choose Deduct full fee, Deduct pro-rata (by boxes completed), Waive the fee, or Block early withdrawal.",
      "Changes apply cleanly as a versioned policy; earned commission posts automatically to Susu → Susu income."
    ]
  },
  {
    id: "susu-income",
    department: "susu",
    title: "Susu income & transferring commission income to Business Capital",
    howTo: "How to track Susu fee income and allocate commission revenue to Business Capital",
    keywords: [
      "susu income",
      "institutional income",
      "fee income",
      "revenue",
      "opening fee",
      "savings opening fee",
      "cycle commission",
      "branch income",
      "transfer to capital",
      "business capital",
      "capital allocation",
      "income allocation",
      "equity",
      "reverse transfer",
      "backfill"
    ],
    modules: ["susu_management"],
    body: [
      "Go to Susu → Susu income to view institutional fee revenue earned by your company (strictly isolated to your tenant’s branches and never mixed with customer deposits).",
      "Two automatic income streams are tracked: Susu cycle fees (earned from customer Susu cycles) and Savings opening fees (recorded for the branch when new savings accounts activate).",
      "Home-branch attribution on inter-branch payouts: if a customer registered at Branch A makes a walk-in withdrawal at Branch B, physical cash leaves Branch B’s till while any Susu withdrawal commission income is automatically credited to Branch A (the customer’s home branch).",
      "Filter by branch, date range, and income source — or search by customer name or account number — to review daily or period totals, branch breakdowns, and any reversed fee entries.",
      "Transferring commission income to Business Capital: authorized Admins and Accountants can open the Transfers to Capital section on Susu → Susu income and click Transfer to Capital to reclassify available branch commission income into Branch Business Capital (with a required reason and optional reference).",
      "Zero vault cash double-counting: because commission cash is already physically inside the branch vault from customer collections, transferring income to Business Capital is recorded as a non-cash equity reclassification (entry type: Income allocation). It atomically debits the branch’s commission income balance and credits Branch Capital while adding GHS 0.00 to physical vault cash — protecting closing vault reconciliation.",
      "Safety, idempotency & reversal: transfers cannot exceed a branch’s available commission income balance, duplicate clicks are protected by idempotency keys, and every transfer can be reversed cleanly with a required audit reason (restoring the branch’s income balance and marking the linked capital entry void, with full Audit Logs tracking).",
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
      "Choose Deposit only (Daily Susu is not posted on branch counter — use Field agent Collect and Callover). Walk-in deposits never require customer identity verification and remain allowed at any branch.",
      "Branch counter locking: tellers, coordinators, and customer service staff always post to their assigned branch counter (the Branch selector stays locked to their counter); Head Office roles (Admin, Accountant, Auditor) can choose any branch.",
      "Enter the amount and post. Deposits increase physical cash in till (by the full gross cash received, even if Susu Box 1 commission applies) and consume float capacity.",
      "For Susu accounts, walk-in counter deposits also check off boxes on the customer’s Susu passbook and apply your Susu cycle fee policy automatically so the passbook stays aligned with contributions.",
      "Withdrawable balance already excludes savings minimum and any loan reserves."
    ]
  },
  {
    id: "susu-withdraw",
    department: "susu",
    title: "Pay a walk-in customer withdrawal (Verify, inter-branch & Simplified KYC)",
    howTo: "How to verify and withdraw at branch counter",
    keywords: [
      "withdrawal",
      "withdraw",
      "susu",
      "branch counter",
      "cash",
      "verify",
      "customer verification",
      "cross-branch",
      "inter-branch",
      "simplified kyc",
      "photo",
      "id card",
      "account statement"
    ],
    modules: ["susu_management"],
    body: [
      "Select the customer on Branch counter and switch to Withdrawal. Check Withdrawable (not full account balance) — any savings opening minimum, loan reserve, or passbook lien is excluded automatically.",
      "Verify customer identity on counter: click Verify (or the customer’s portrait avatar) to open the instant verification modal without losing your typed amount. Inspect the customer’s portrait photo and ID card photo side-by-side (click either image to enlarge), Tier 1 Simplified KYC introducer details, phone, address, next of kin, balances, and compact Susu passbook, then click Mark verified & continue. You can also click Open full statement → to inspect the complete statement and return with ← Back to branch counter.",
      "When verification is mandatory: Tier 1 Simplified KYC accounts ALWAYS require verification on walk-in withdrawals regardless of company settings. Full KYC walk-in withdrawals follow your company’s rule in Settings → Approval Workflows (Optional, Cross-branch only, or Always mandatory). Deposits never require verification, and already-approved Pay now field withdrawals are exempt.",
      "Cross-branch walk-in withdrawals: when a customer registered at another branch withdraws at your counter, an Inter-branch customer banner appears. Cash is paid from your counter till while any Susu withdrawal commission income credits the customer’s home branch. Admins can allow or disable cross-branch walk-in withdrawals in Settings → Approval Workflows.",
      "Withdrawals need physical cash in the till — float alone is not cash. If cash is short, use Till movement → Extra cash (needs approval).",
      "If your Susu cycle fee timing is set to Withdrawal (or an early-withdrawal fee applies), the system evaluates the active Susu cycle automatically and posts the fee as a separate Debit (commission) entry."
    ]
  },
  {
    id: "susu-withdrawal-gate-momo",
    department: "susu",
    title: "Withdrawal gate (MoMo, Bank & remote withdrawal approvals + live name lookup)",
    howTo: "How to approve MoMo, Bank, and Cash withdrawals",
    keywords: [
      "withdrawal gate",
      "momo",
      "mobile money",
      "bank transfer",
      "paystack",
      "name lookup",
      "verify",
      "pay now",
      "payout",
      "customer service"
    ],
    modules: ["susu_management"],
    body: [
      "Go to Susu → Withdrawal gate to review pending MoMo, Bank transfer, and remote Cash withdrawal requests.",
      "Live Ghana account name lookup: click Verify next to a MoMo number or Ghana bank account to confirm the registered holder name via Paystack before approving.",
      "Unified 2-step flow (Approve → Teller Pay now): approving a request verifies it and queues it on Branch counter → Pay now without debiting the customer yet and without requiring a manual proof screenshot upload.",
      "When the teller clicks Pay now on Branch counter (with an open till holding sufficient cash), the system debits the customer account, reduces till cash, and marks the payout delivered in one atomic step."
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
    title: "End-of-day till balancing & prior-day till guard",
    howTo: "How to close and balance the till",
    keywords: [
      "close till",
      "balance",
      "expected cash",
      "variance",
      "eod",
      "end of day",
      "unclosed till",
      "prior day",
      "absent teller"
    ],
    modules: ["susu_management"],
    body: [
      "Expected cash in till = initial cash + extra cash + deposits − withdrawals − field Pay now − expenses. Day capital is not what you count.",
      "Count physical cash in the drawer and enter Actual cash counted. The screen flags Balanced, Overage, or Shortage automatically as you type.",
      "Close till. Non-zero variance opens a Branch till case on Overages/Shortages automatically (separate from field agent cases). A note is required for overage or shortage.",
      "Prior-day till guard: a teller cannot request or be pushed a new day’s till while their earlier day’s till is still open. Branch counter shows an amber banner with a 1-click Close prior till modal so the teller can count and close it first.",
      "Absent teller safety valve: if a teller is away and left a prior till open, Admin or Coordinator can close that prior till directly from the Prior unclosed tills card at the top of Susu → Till float.",
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
    title: "Branch vault closing balances & multi-day carry-forward",
    howTo: "How to close the branch vault",
    keywords: [
      "closing balances",
      "vault",
      "safe",
      "cash to bank",
      "opening vault",
      "till",
      "field agent",
      "branch worksheet",
      "missed closing",
      "prior day",
      "eod guard"
    ],
    modules: ["susu_management"],
    body: [
      "Go to Susu → Closing balances. Pick branch and business date.",
      "Opening vault auto-fills from the latest saved closing balance and automatically chains forward across any unsaved intermediate days using real branch cash movements — so if a closing count was skipped yesterday, no cash movement is lost.",
      "Prior-day EOD checklist banner: whenever yesterday’s vault closing count was not saved, prior teller tills remain open, or field agent batches remain unposted/unsubmitted, a warning banner appears at the top with 1-click shortcuts to Open yesterday & close, Review open tills, or Post pending batches.",
      "Tills: cash issued = initial + extra cash (not float). Closed tills return to vault; open tills show as still in drawers.",
      "Field deposits increase the vault; field withdrawals decrease it. Walk-in activity stays inside till cash.",
      "Enter cash to bank (Susu worksheet only — Banking Treasury post comes later), optional vault count, and save.",
      "Expected closing vault = opening − issued to tills + field deposits − field withdrawals + returned closed tills − cash to bank − extra branch expenses. Commission-to-capital allocations (Income allocation entries) appear on Branch Capital without altering physical vault cash.",
      "Print Daily EOD Summary: click Print Daily EOD Summary at the top of Susu → Closing balances to generate a signed 1-page branch vault sheet with Coordinator, Branch Manager, and Internal Audit sign-off lines.",
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
    title: "Routes, Route Reorganization, tenant assignment strategies, field agents & coordinators",
    howTo: "How to configure route strategies, reorganize customers, and manage field agents",
    keywords: [
      "routes",
      "route reorganization",
      "reorganize",
      "strategy",
      "registration-based",
      "location-based",
      "manual assignment",
      "communities",
      "geographical area",
      "location match",
      "bulk reassign",
      "original creator",
      "assignment history",
      "transfers",
      "agents",
      "field agents",
      "mobilizer",
      "coordinators",
      "territory",
      "assign"
    ],
    modules: ["susu_management"],
    body: [
      "Go to Susu → Routes to create and manage collection routes per branch, define each route’s primary area and covered communities, assign responsible field mobilizers, manage route members, and transfer individual customers.",
      "Tenant-specific route assignment strategies (Susu → Routes → Route Reorganization): each company independently selects its own strategy without affecting other tenants — Registration-Based (keeps the registering mobilizer and optionally auto-attaches their sole active branch route on approval), Location-Based (matches a customer’s recorded location against branch routes’ areas and covered communities to suggest or auto-assign unambiguous routes), or Manual (full administrator control with no automatic location or registration reassignment).",
      "Approval-time route assignment: when approving a pending customer in Review registration, the system displays the company’s active strategy and any matching branch route recommendation. Ambiguous multi-route matches or incomplete locations are never guessed — the approver selects the route explicitly or leaves the customer unassigned for later organization.",
      "Original creator vs operational assignment: a customer’s Original creator (who registered the account) is permanently preserved and never overwritten when routes or mobilizers change. Reassigning a customer’s route or mobilizer never alters their savings, Susu passbook, contributions, loans, or financial history.",
      "Route Reorganization workspace (Susu → Routes → Route Reorganization): authorized administrators and coordinators can view all active customers in a branch, filter by community/location, current route, customers without a route, or mobilizer, run Review location matches to stage unambiguous location suggestions, select individual or multiple customers, preview every previous → new route and mobilizer change in a confirmation modal, and apply bulk updates atomically.",
      "Immutable Assignment History: every route or mobilizer change (approval, transfer, bulk reorganization, route-agent sync, route member update, or route deletion) is permanently recorded with previous/new route, previous/new mobilizer, actor, timestamp, and reason. View full branch history under Route Reorganization or per-customer history under Customer Details → Branch & servicing.",
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
      "Susu → Agent commissions configures payroll commission rules paid to field agents and coordinators based on collections (separate from company revenue in Susu → Susu cycle fees and Susu → Susu income).",
      "Admins can choose between the Cycle share formula — (Total Collected ÷ Cycle Days) × Multiplier (default: Total ÷ 31 × 0.5, fully editable by the admin) — or a Flat percentage rate, plus tiered performance bonuses.",
      "Commission breakdown statement: on Susu → Payroll (click Breakdown on any staff row) or Susu → Agents → Details → Commission breakdown, review the exact day-by-day posted collection totals, formula calculation, tier bonus, open field-agent cash shortages, and net reference amount before running payroll.",
      "Modernized Susu → Payroll workspace: view executive KPIs (Projected gross, Projected net pay, Total deductions, Published payslips), switch cleanly between Live staff payroll, Published payslips (with modal payslip preview), and My payslip, search/filter by staff name or role, adjust loan deductions or commission % inline, export the payroll schedule to CSV, and click Pay by role to configure standard base salary, bonus, SSNIT, welfare, and default loan deductions per role.",
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
    title: "Field agent daily collection, extra batches, fixing rejected registrations & Susu passbook",
    howTo: "How field agents collect, fix returned accounts, and submit call-over",
    keywords: [
      "field agent",
      "mobilizer",
      "collect",
      "offline",
      "sync",
      "daily susu",
      "extra batch",
      "batch 2",
      "rejected",
      "fix and resubmit",
      "returned registration",
      "passbook",
      "susu passbook",
      "unsubmitted batch",
      "prior day"
    ],
    modules: ["susu_management"],
    body: [
      "Open the Field agent app → Collect.",
      "Select the customer, enter the daily Susu amount (single day, multi-day, or partial payment), and save. (Branch counter does not post Daily Susu.)",
      "Offline collections queue on the device and sync automatically when the phone is back online. Whenever items are queued offline, an Offline sync queue inspector card appears on the Home screen showing every pending collection/registration with a manual Retry sync now button.",
      "Use Call over to submit the day's batch for coordinator approval and posting. If a previous day’s draft batch was never submitted, an amber reminder card appears at the top of the Home screen with a 1-tap Submit button.",
      "Extra batches (Batch #2+): if you accidentally submitted call-over early and your coordinator unlocks Batch #2, a Batch #2 unlocked banner appears on your Home screen and Collect page so you can keep recording remaining collections for the day separately from Batch #1.",
      "Fixing returned / rejected registrations: if a coordinator rejects or sends back a customer registration for correction, a highlighted alert banner appears on your Home screen and a Needs fix tab appears under Customers. Tap Fix & resubmit to open the pre-filled form (with saved photos and the coordinator’s note), make the requested changes, and resubmit for approval without creating a duplicate customer.",
      "Tap Susu passbook on any active Susu customer card under Customers to show the customer their checked boxes, partial progress, Balance Brought Forward (BBF), Fee box, and past completed or red-line cancelled pages."
    ]
  },
  {
    id: "agent-withdrawal-pay-now",
    department: "susu",
    title: "Remote cash, MoMo & Bank withdrawals (Approve → Pay now)",
    howTo: "How remote customer withdrawals work",
    keywords: [
      "withdrawal",
      "pay now",
      "field agent",
      "teller",
      "coordinator",
      "momo",
      "bank transfer",
      "registration phone"
    ],
    modules: ["susu_management"],
    body: [
      "Field agent (or Customer Service) requests a Cash, MoMo, or Bank withdrawal on behalf of a customer.",
      "Coordinator reviews the request, calls the customer on the registration phone (and can click Verify to confirm the registered Ghana MoMo or bank holder name via Paystack), then clicks Approve.",
      "Approve does not debit the account and does not move vault cash — it queues the payout on Branch counter → Pay now.",
      "Teller opens till with enough physical cash (use Extra cash from vault if needed) and clicks Pay now.",
      "Pay now debits the customer account, reduces till cash (shown separately from walk-in withdrawals on EOD), and marks the withdrawal delivered — no manual proof upload required.",
      "For cash delivery, the agent collects the cash from the office and delivers it on the next visit.",
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
    id: "susu-risk-alerts",
    department: "susu",
    title: "Cash control & fraud alerts (dormant customers & zero-collection agents)",
    howTo: "How to monitor dormant accounts and zero-collection agents",
    keywords: [
      "dormant",
      "inactive",
      "fraud",
      "risk",
      "zero collection",
      "uncollected",
      "alert",
      "monitoring"
    ],
    modules: ["susu_management"],
    body: [
      "Dormant Susu customer alerts (Susu → Customers): active Susu accounts with no posted contribution for 7+, 14+, or 30+ days are flagged automatically at the top of the Customers page. Switch thresholds (7d+ / 14d+ / 30d+) and click View statement on any flagged customer to verify whether collections were missed or unrecorded.",
      "Zero-collection agent alerts (Susu → Agents): active field agents who have assigned Susu customers yet have GHS 0 recorded today are highlighted at the top of the Agents page so coordinators can follow up on route activity or pending offline syncs before end of day."
    ]
  },
  {
    id: "settings-approval-workflows",
    department: "settings",
    title: "Approval workflows, cross-branch withdrawals & counter verification rules",
    howTo: "How to configure approval roles and branch counter rules",
    keywords: [
      "approval workflows",
      "approver roles",
      "new account approval",
      "withdrawal approval",
      "branch counter rules",
      "cross-branch",
      "inter-branch",
      "customer verification",
      "simplified kyc",
      "pay now"
    ],
    body: [
      "Go to Settings → Approval Workflows to configure who approves new accounts and withdrawal requests, and to set frontline branch counter rules.",
      "New account approval & Withdrawal request approval: select which staff roles can approve or reject customer registrations and customer withdrawal requests. Company admin always stays enabled on both; field agents submit requests and are never approvers.",
      "Cross-branch walk-in withdrawals toggle: turn ON (default) to let customers withdraw walk-in cash at any branch (cash leaves the paying branch’s till while Susu commission credits the customer’s home branch), or turn OFF to restrict walk-in withdrawals to each customer’s registered home branch. Walk-in deposits remain allowed at any branch.",
      "Walk-in withdrawal customer verification mode: choose Optional for Full KYC (fastest), Cross-branch only (balanced — verifies inter-branch payouts), or Always mandatory (strictest — verifies every walk-in withdrawal).",
      "Fixed compliance safeguards: Tier 1 Simplified KYC accounts always require photo & introducer verification on walk-in withdrawals regardless of the selected mode; Deposits and Daily Susu never require verification; already-approved Pay now field withdrawals are exempt."
    ]
  },
  {
    id: "settings-audit-export",
    department: "settings",
    title: "Audit logs, quick category filters, and CSV export",
    howTo: "How to filter and export audit logs",
    keywords: [
      "audit",
      "audit logs",
      "csv",
      "export",
      "compliance",
      "withdrawals",
      "reversals",
      "super admin",
      "edit profile",
      "tenant health"
    ],
    body: [
      "Go to Settings → Audit logs to review a full timestamped trail of staff actions across your workspace.",
      "Use the quick filter chips (All events, Withdrawals, Reversals, Till & Cash, Profiles & Roles, Approvals) combined with text search to isolate specific events in seconds.",
      "Click Export CSV to download the currently filtered audit rows for external or internal audit review.",
      "Platform Super Admins can also update any company’s profile, logo, brand color, and contact details via Companies → Edit profile, monitor live per-company health badges (active staff, active customers, prior open tills, SMS status, and last activity) directly on the Companies screen, and open Platform → Backups & Snapshots to verify any company’s immutable audit hash chain, download checksummed per-tenant or all-tenant financial JSON snapshots, export customer balances CSV sheets, and manage automated nightly GPG AES-256 encrypted GitHub database backups."
    ]
  },
  {
    id: "settings-form-setup",
    department: "settings",
    title: "Registration form setup, Savings opening fee options, Simplified KYC & printable paper forms",
    howTo: "How to configure registration forms, Simplified KYC rules, and print blank forms",
    keywords: [
      "form setup",
      "paper form",
      "print form",
      "savings opening fee",
      "cash collected now",
      "deduct later",
      "simplified kyc",
      "balance cap",
      "withdrawal request toggle",
      "tally sheet",
      "walk-in deposit slip"
    ],
    body: [
      "Go to Settings → Form setup to customize registration account types, required/optional/hidden fields, and downloadable paper sheets.",
      "Savings initial deposit & locked minimum balance: set your company’s Minimum locked balance / initial deposit (GHS, e.g. GHS 20) under Settings → Form setup. Normal Savings registrations automatically hide Daily contribution and require an initial deposit at least equal to that minimum. Lock timing follows your When to deduct rule under Susu → Susu cycle fees.",
      "Tier 1 · Simplified KYC settings: toggle Allow Simplified KYC registration ON/OFF, set the Maximum account balance cap (GHS, default 5,000; 0 for no cap), and toggle Allow field agent withdrawal requests for Simplified KYC accounts (off by default for branch face-verified withdrawals; turn on to let field agents request withdrawals for coordinator approval).",
      "Printable single-page A4 paper forms: print or download your company’s Standard Registration Form, the dedicated single-page A4 Simplified KYC (Tier 1) Registration & Local Introducer Attestation Form, the Daily Tally Sheet (40 rows), and 6-per-sheet Walk-in Deposit Slips."
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
    id: "settings-announcements",
    department: "settings",
    title: "Publish timed floating top-bar announcements",
    howTo: "How to broadcast announcements with a timer",
    keywords: ["announcement", "banner", "floating bar", "timer", "maintenance", "broadcast", "super admin"],
    body: [
      "Company admins can open Settings → Announcements to publish a company-wide message displayed in the single floating bar at the top of both the back-office dashboard and the field agent app.",
      "Platform Super Admins can open Platform → Announcements to broadcast a site-wide maintenance or update notice across every company on the platform.",
      "Set a countdown timer using quick presets (15 min to 24 hrs), custom minutes, a specific end date & time, or run until manually stopped. Once the timer reaches zero, the floating bar hides automatically.",
      "Use +15m / +1h to extend a live timer, Stop now to take down an announcement immediately, or uncheck Allow users to dismiss for critical pinned notices."
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
