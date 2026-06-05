export type AuditActivityResult = {
  /** When true, do not write an audit log row. */
  skip: boolean;
  /** Human-readable activity for auditors. */
  action: string;
};

type ActivityRule = {
  methods?: string[];
  pattern: RegExp;
  action: string;
};

function normalizeAuditPath(path: string): string {
  const withoutQuery = path.split("?")[0] ?? path;
  const trimmed = withoutQuery.replace(/^\/api\/v1/, "") || "/";
  return trimmed.length > 0 ? trimmed : "/";
}

function statusSuffix(statusCode: number): string {
  if (statusCode >= 500) {
    return " (server error)";
  }
  if (statusCode >= 400) {
    return " (failed)";
  }
  return "";
}

/** Low-value or read-style mutations — not business audit events. */
const SKIP_PATTERNS: RegExp[] = [
  /^\/customers\/notifications\/[^/]+\/read$/i
];

const ACTIVITY_RULES: ActivityRule[] = [
  { methods: ["POST"], pattern: /^\/auth\/login$/i, action: "Signed in" },
  { methods: ["POST"], pattern: /^\/auth\/logout$/i, action: "Signed out" },
  { methods: ["POST"], pattern: /^\/auth\/change-password$/i, action: "Changed own password" },

  { methods: ["POST"], pattern: /^\/customers\/registrations$/i, action: "Submitted customer registration" },
  { methods: ["POST"], pattern: /^\/customers$/i, action: "Created customer" },
  { methods: ["PATCH"], pattern: /^\/customers\/[^/]+\/approve$/i, action: "Approved customer registration" },
  { methods: ["PATCH"], pattern: /^\/customers\/[^/]+\/reject$/i, action: "Rejected customer registration" },
  {
    methods: ["PATCH"],
    pattern: /^\/customers\/[^/]+\/assignment$/i,
    action: "Assigned field agent to customer"
  },
  {
    methods: ["PATCH"],
    pattern: /^\/customers\/balance-disclosures\/[^/]+\/approve$/i,
    action: "Approved balance or withdrawal request"
  },
  {
    methods: ["PATCH"],
    pattern: /^\/customers\/balance-disclosures\/[^/]+\/reject$/i,
    action: "Rejected balance or withdrawal request"
  },
  {
    methods: ["POST"],
    pattern: /^\/customers\/[^/]+\/balance-disclosures$/i,
    action: "Requested balance or withdrawal approval"
  },

  { methods: ["POST"], pattern: /^\/transactions$/i, action: "Posted transaction" },
  { methods: ["POST"], pattern: /^\/transactions\/branch-float\/request$/i, action: "Requested till float" },
  {
    methods: ["POST"],
    pattern: /^\/transactions\/branch-float\/[^/]+\/allocate$/i,
    action: "Released till float to counter"
  },
  { methods: ["POST"], pattern: /^\/transactions\/branch-float\/push$/i, action: "Pushed till float to teller" },
  {
    methods: ["POST"],
    pattern: /^\/transactions\/branch-float\/[^/]+\/close$/i,
    action: "Closed till — end of day"
  },
  {
    methods: ["POST"],
    pattern: /^\/transactions\/branch-float\/[^/]+\/settle$/i,
    action: "Settled closed till session"
  },

  { methods: ["POST"], pattern: /^\/users$/i, action: "Created staff user" },
  { methods: ["PATCH"], pattern: /^\/users\/[^/]+$/i, action: "Updated staff user" },
  { methods: ["DELETE"], pattern: /^\/users\/[^/]+$/i, action: "Deleted staff user" },
  {
    methods: ["POST"],
    pattern: /^\/users\/[^/]+\/reset-password$/i,
    action: "Reset staff user password"
  },

  { methods: ["POST"], pattern: /^\/branches$/i, action: "Created branch" },
  { methods: ["PATCH"], pattern: /^\/branches\/[^/]+$/i, action: "Updated branch" },
  { methods: ["DELETE"], pattern: /^\/branches\/[^/]+$/i, action: "Deleted branch" },

  { methods: ["POST"], pattern: /^\/admin\/roles$/i, action: "Created custom role" },
  { methods: ["POST"], pattern: /^\/admin\/roles\/assign$/i, action: "Assigned custom role to user" },
  {
    methods: ["PUT"],
    pattern: /^\/admin\/roles\/builtin\/[^/]+$/i,
    action: "Updated job title permissions"
  },
  {
    methods: ["DELETE"],
    pattern: /^\/admin\/roles\/builtin\/[^/]+$/i,
    action: "Reset job title permissions to defaults"
  },

  { methods: ["POST"], pattern: /^\/payroll\/run$/i, action: "Ran payroll" },
  { methods: ["PUT"], pattern: /^\/payroll\/profiles\/[^/]+$/i, action: "Updated payroll profile" },
  { methods: ["PUT"], pattern: /^\/payroll\/role-defaults\/[^/]+$/i, action: "Updated payroll role defaults" },

  { methods: ["PUT"], pattern: /^\/tenant\/commission-policy$/i, action: "Updated commission policy" },
  { methods: ["PUT"], pattern: /^\/tenant\/account-number-policy$/i, action: "Updated account number policy" },

  { methods: ["POST"], pattern: /^\/platform\/tenants$/i, action: "Created tenant company" },
  { methods: ["PATCH"], pattern: /^\/platform\/tenants\/[^/]+$/i, action: "Updated tenant company" },

  { methods: ["POST"], pattern: /^\/routes$/i, action: "Created collection route" },
  { methods: ["PATCH"], pattern: /^\/routes\/[^/]+$/i, action: "Updated collection route" },
  { methods: ["PUT"], pattern: /^\/routes\/[^/]+\/members$/i, action: "Updated route members" },
  { methods: ["DELETE"], pattern: /^\/routes\/[^/]+$/i, action: "Deleted collection route" },

  { methods: ["POST"], pattern: /^\/field-agents\/me\/callover\/report$/i, action: "Submitted field callover report" },
  {
    methods: ["POST"],
    pattern: /^\/field-agents\/me\/collection-batches\/lines$/i,
    action: "Recorded field collection (pending batch)"
  },
  {
    methods: ["POST"],
    pattern: /^\/field-agents\/me\/collection-batches\/submit-for-approval$/i,
    action: "Sent collection batch for approval"
  },
  { methods: ["POST"], pattern: /^\/collection-batches\/[^/]+\/post$/i, action: "Posted field collection batch" },
  { methods: ["POST"], pattern: /^\/collection-batches\/post-all$/i, action: "Posted all field collection batches" },
  {
    methods: ["POST"],
    pattern: /^\/field-agents\/me\/customers\/[^/]+\/customer-request$/i,
    action: "Submitted withdrawal or balance request"
  },
  {
    methods: ["POST"],
    pattern: /^\/field-agents\/me\/customers\/[^/]+\/balance-request$/i,
    action: "Requested customer balance visibility"
  },

  { methods: ["POST"], pattern: /^\/chat\/threads$/i, action: "Started chat thread" },
  { methods: ["POST"], pattern: /^\/chat\/threads\/[^/]+\/messages$/i, action: "Sent chat message" },
  { methods: ["POST"], pattern: /^\/chat\/inbox\/[^/]+\/messages$/i, action: "Sent inbox message" },

  { methods: ["POST"], pattern: /^\/sync\//i, action: "Synced offline data" }
];

const METHOD_VERBS: Record<string, string> = {
  POST: "Created",
  PUT: "Updated",
  PATCH: "Updated",
  DELETE: "Deleted"
};

function fallbackAction(method: string, normalizedPath: string): string {
  const segment = normalizedPath.split("/").filter(Boolean)[0] ?? "record";
  const label = segment.replace(/-/g, " ");
  const verb = METHOD_VERBS[method.toUpperCase()] ?? method;
  return `${verb} ${label}`;
}

export function resolveAuditActivity(
  method: string,
  path: string,
  statusCode: number
): AuditActivityResult {
  const normalized = normalizeAuditPath(path);
  const upperMethod = method.toUpperCase();

  for (const skip of SKIP_PATTERNS) {
    if (skip.test(normalized)) {
      return { skip: true, action: "" };
    }
  }

  for (const rule of ACTIVITY_RULES) {
    if (rule.methods && !rule.methods.map((m) => m.toUpperCase()).includes(upperMethod)) {
      continue;
    }
    if (rule.pattern.test(normalized)) {
      return {
        skip: false,
        action: `${rule.action}${statusSuffix(statusCode)}`
      };
    }
  }

  return {
    skip: false,
    action: `${fallbackAction(upperMethod, normalized)}${statusSuffix(statusCode)}`
  };
}
