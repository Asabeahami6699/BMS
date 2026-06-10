import { Link, useNavigate } from "react-router-dom";
import { BMS_CONTACT_EMAIL } from "../app/chatApi";
import { getAuthSession } from "../app/api";
import { useAuth } from "../auth/AuthContext";
import { getHomePathForRole } from "../auth/roleRedirect";
import { BmsBrandIcon } from "../components/BmsBrandIcon";
import { LiveChatWidget } from "../components/LiveChatWidget";
import { RevealOnScroll } from "../components/RevealOnScroll";
import { ThemeToggle } from "../components/ThemeToggle";

const heroBadges = [
  "Agency banking desks",
  "Universal staff hub",
  "Susu & member ledger",
  "Accountant & auditor control"
];

const pillars = [
  {
    tag: "Savings",
    title: "Susu & member accounts",
    text: "Daily collections, deposits, withdrawals, and one balance per member across every branch.",
    points: ["Field agent posting", "Callover & till float", "Customer profiles & CIF"]
  },
  {
    tag: "Banking",
    title: "Agency banking operations",
    text: "Teller, customer service, and back office workflows with partner bank products and branch reconciliation.",
    points: ["Deposits & withdrawals", "Account opening", "Back-office execution"],
    highlight: true
  },
  {
    tag: "Finance",
    title: "Accountant & auditor desks",
    text: "Grouped dashboards for cash positions, trial balance, approvals, exception review, and branch summaries.",
    points: ["Trial balance & vault control", "High-value transaction review", "Audit logs & compliance"]
  },
  {
    tag: "People",
    title: "HR & Universal Operations",
    text: "Every staff member gets attendance, leave, loans, announcements, documents, and incident reporting in one hub.",
    points: ["Employee profiles & payroll", "Leave & training records", "Incident workflow"]
  }
];

const bankingDesks = [
  {
    icon: "₵",
    title: "Teller desk",
    text: "Record deposits, pay withdrawals, reconcile the till, and run the daybook from one workspace."
  },
  {
    icon: "☎",
    title: "Customer service",
    text: "Approve withdrawals, open accounts, and serve members at the counter with clear queues."
  },
  {
    icon: "🏦",
    title: "Back office",
    text: "Execute at the bank, balance company accounts across branches, and manage ecash requests."
  },
  {
    icon: "📊",
    title: "Accountant",
    text: "Deposits, withdrawals, vault and bank cash, loan portfolios, trial balance, and branch financial summaries."
  },
  {
    icon: "🔍",
    title: "Auditor",
    text: "Review queues, cash differences, reversed transactions, activity logs, and compliance exceptions."
  },
  {
    icon: "👥",
    title: "Human resources",
    text: "Profiles, branch assignments, attendance, leave, appointments, payroll, roles, and training."
  }
];

const universalOps = [
  { icon: "⏰", title: "Attendance", text: "Clock in and out, breaks, history, and monthly reports." },
  { icon: "🌴", title: "Leave management", text: "Annual, sick, maternity, and other leave types with approvals." },
  { icon: "💰", title: "Staff loans", text: "Apply, track repayments, and view schedules from your portal." },
  { icon: "📢", title: "Announcements", text: "Company news, policies, holidays, and training notices." },
  { icon: "📄", title: "Documents center", text: "Handbooks, SOPs, AML guidelines, and circulars in one library." },
  { icon: "🚨", title: "Incident reporting", text: "Cash variances, fraud signals, complaints, and operational errors." }
];

const features = [
  {
    icon: "🏢",
    title: "Multi-tenant workspaces",
    text: "Each cooperative runs in its own secure workspace with branches, subscribed products, and isolated data.",
    tag: null
  },
  {
    icon: "◎",
    title: "Single customer ledger",
    text: "Members keep one balance across branches—deposit or withdraw at any branch without splitting accounts.",
    tag: null
  },
  {
    icon: "⇄",
    title: "Daily Susu & transactions",
    text: "Record collections and movements with idempotent posting, audit trails, and live balance updates.",
    tag: null
  },
  {
    icon: "🏦",
    title: "Agency banking module",
    text: "Role-based desks for tellers, CS, back office, accountants, auditors, and HR—with collapsible sidebar navigation.",
    tag: "New"
  },
  {
    icon: "🌐",
    title: "Universal Operations",
    text: "Every employee sees attendance, leave, staff loans, announcements, documents, and incidents in one staff hub.",
    tag: "New"
  },
  {
    icon: "💳",
    title: "Loans & credit products",
    text: "Individual and group solidarity loans with products, workflows, disbursement, and repayment tracking.",
    tag: null
  },
  {
    icon: "👥",
    title: "Group solidarity lending",
    text: "Register loan groups with officers and members; apply on behalf of members with full assessment.",
    tag: null
  },
  {
    icon: "📋",
    title: "Credit assessment",
    text: "Income, occupation, guarantor details, and identity capture—with printable application forms.",
    tag: null
  },
  {
    icon: "◇",
    title: "Treasury & trial balance",
    text: "Cash positions and movements where subscribed; accountants can reconcile vault, teller, and bank without extra modules.",
    tag: "New"
  },
  {
    icon: "⌂",
    title: "Branches & head office",
    text: "Head-office scope or branch-scoped staff. Mobilizers and coordinators work where members actually save.",
    tag: null
  },
  {
    icon: "▤",
    title: "Reports & exports",
    text: "Summary, agent, branch, and loans performance with CSV export for reconciliation and supervision.",
    tag: null
  },
  {
    icon: "🔐",
    title: "Permission-driven access",
    text: "Custom job titles and duty bundles—granular permissions without locking every user to a fixed role.",
    tag: null
  }
];

const loanSpotlight = [
  {
    step: "1",
    title: "Register solidarity groups",
    text: "Create groups at a branch, assign roles, and onboard existing customers as members."
  },
  {
    step: "2",
    title: "Apply with full assessment",
    text: "Staff capture guarantor, income, purpose, and identity photos before submission."
  },
  {
    step: "3",
    title: "Approve, disburse, repay",
    text: "Workflow from pending approval through disbursement with installment tracking and overdue visibility."
  }
];

const roles = [
  {
    title: "Company administrator",
    text: "Configures branches, users, products, commission rules, and job titles—the control center for each cooperative."
  },
  {
    title: "Teller & customer service",
    text: "Serves members at the counter: deposits, withdrawals, account opening, and payout approvals."
  },
  {
    title: "Back office & finance",
    text: "Executes bank transactions, balances company accounts, and supports accountant review queues."
  },
  {
    title: "Accountant & auditor",
    text: "Monitors cash positions, trial balance, exceptions, high-value items, and audit trails."
  },
  {
    title: "HR & every staff member",
    text: "HR manages people operations; all staff use Universal Operations for attendance, leave, and workplace tools."
  },
  {
    title: "Field agent & coordinator",
    text: "Onboards customers, posts Susu collections, and—with permissions—supports loan applications in the field."
  }
];

const steps = [
  {
    n: "01",
    title: "Onboard your cooperative",
    text: "Contact us to register your organization with the products you need—Susu, agency banking, loans, or treasury."
  },
  {
    n: "02",
    title: "Configure branches & desks",
    text: "Set up branches, bank products, loan products, commission rules, and staff accounts with the right permissions."
  },
  {
    n: "03",
    title: "Operate in the field & branch",
    text: "Agents record Susu; tellers and CS serve members; back office executes at partner banks."
  },
  {
    n: "04",
    title: "Supervise, report & comply",
    text: "Accountants and auditors review dashboards; HR runs payroll; staff use Universal Operations daily."
  }
];

const highlights = [
  { value: "6+ desks", label: "Agency banking role workspaces" },
  { value: "Universal Ops", label: "Staff hub for every employee" },
  { value: "Live sync", label: "Dashboards refresh in the background" },
  { value: "Audit-ready", label: "Traceable postings & review queues" }
];

export function LandingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const session = getAuthSession();

  function handlePrimaryCta() {
    if (session?.accessToken && user) {
      navigate(getHomePathForRole(user.role));
      return;
    }
    navigate("/login");
  }

  return (
    <div className="landing">
      <header className="landing-nav landing-animate-in landing-animate-in--nav">
        <Link to="/" className="landing-nav-brand">
          <BmsBrandIcon />
          <span>
            <strong>BMS</strong>
            <small>Banking Management System</small>
          </span>
        </Link>

        <nav className="landing-nav-links" aria-label="Primary">
          <a href="#platform">Platform</a>
          <a href="#banking">Banking</a>
          <a href="#universal-ops">Staff hub</a>
          <a href="#loans">Loans</a>
          <a href="#features">Features</a>
          <a href="#contact">Contact</a>
        </nav>

        <div className="landing-nav-actions">
          <ThemeToggle />
          {session?.accessToken && user ? (
            <button type="button" className="button" onClick={handlePrimaryCta}>
              Go to dashboard
            </button>
          ) : (
            <>
              <Link to="/login" className="landing-link-btn">
                Sign in
              </Link>
              <button type="button" className="button" onClick={handlePrimaryCta}>
                Get started
              </button>
            </>
          )}
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow landing-animate-in landing-animate-in--1">
            Savings, agency banking & staff operations for cooperatives
          </p>
          <h1 className="landing-animate-in landing-animate-in--2">
            Run Susu, branch banking, and{" "}
            <span className="landing-gradient-text">every desk from one system</span>
          </h1>
          <p className="landing-lead landing-animate-in landing-animate-in--3">
            BMS is a modern Banking Management System for multi-branch cooperatives and MFIs—daily Susu collections,
            agency banking with teller and back-office desks, accountant and auditor control centres, HR operations,
            and Universal Operations so every employee can manage attendance, leave, and workplace requests.
          </p>
          <ul className="landing-hero-badges landing-animate-in landing-animate-in--4" aria-label="Highlights">
            {heroBadges.map((badge) => (
              <li key={badge}>{badge}</li>
            ))}
          </ul>
          <div className="landing-hero-cta landing-animate-in landing-animate-in--5">
            <button type="button" className="button landing-cta-primary" onClick={handlePrimaryCta}>
              {session?.accessToken && user ? "Open your dashboard" : "Sign in to your workspace"}
            </button>
            <a href="#banking" className="button secondary landing-cta-secondary">
              Explore agency banking
            </a>
          </div>
          <p className="landing-hero-note muted landing-animate-in landing-animate-in--6">
            New to BMS? Chat with our team or email us—we help cooperatives register and go live quickly.
          </p>
        </div>

        <div className="landing-hero-panel landing-animate-in--panel" aria-hidden>
          <div className="landing-mock-card landing-animate-in landing-animate-in--6">
            <p className="landing-mock-label">Accountant dashboard</p>
            <p className="landing-mock-value">Cash &amp; liquidity</p>
            <div className="landing-mock-bars">
              <span className="landing-mock-bar" style={{ height: "45%" }} />
              <span className="landing-mock-bar" style={{ height: "72%" }} />
              <span className="landing-mock-bar" style={{ height: "58%" }} />
              <span className="landing-mock-bar" style={{ height: "90%" }} />
              <span className="landing-mock-bar" style={{ height: "65%" }} />
              <span className="landing-mock-bar" style={{ height: "80%" }} />
            </div>
          </div>
          <div className="landing-mock-card landing-mock-card--small landing-animate-in landing-animate-in--7">
            <p className="landing-mock-label">Universal Operations</p>
            <p className="landing-mock-value">Staff hub</p>
            <p className="landing-mock-meta">Attendance · Leave · Docs</p>
          </div>
          <div className="landing-mock-card landing-mock-card--small landing-mock-card--accent landing-animate-in landing-animate-in--8">
            <p className="landing-mock-label">Auditor queue</p>
            <p className="landing-mock-value">Review</p>
            <p className="landing-mock-meta">Exceptions &amp; compliance</p>
          </div>
          <div className="landing-mock-card landing-mock-card--wide landing-animate-in landing-animate-in--8">
            <div className="landing-mock-row">
              <span className="landing-mock-pill landing-mock-pill--success">Teller desk</span>
              <span className="landing-mock-pill">Back office</span>
              <span className="landing-mock-pill landing-mock-pill--warn">Trial balance</span>
            </div>
            <p className="landing-mock-caption">Agency banking · role-based workspaces</p>
          </div>
        </div>
      </section>

      <section className="landing-stats" id="highlights">
        {highlights.map((item, index) => (
          <RevealOnScroll key={item.label} as="article" className="landing-stat" delay={index * 90}>
            <p className="landing-stat-value">{item.value}</p>
            <p className="landing-stat-label">{item.label}</p>
          </RevealOnScroll>
        ))}
      </section>

      <section className="landing-section landing-section--alt" id="platform">
        <RevealOnScroll className="landing-section-head landing-section-head--center">
          <p className="landing-eyebrow">Four pillars, one workspace</p>
          <h2>Susu, agency banking, finance control, and staff operations together</h2>
          <p className="muted landing-section-sub">
            Start with daily collections. Add partner-bank agency workflows, accountant and auditor dashboards, and
            a Universal Operations hub so every employee has the tools they need.
          </p>
        </RevealOnScroll>
        <div className="landing-pillar-grid landing-pillar-grid--four">
          {pillars.map((pillar, index) => (
            <RevealOnScroll
              key={pillar.title}
              as="article"
              className={`landing-pillar-card${pillar.highlight ? " landing-pillar-card--highlight" : ""}`}
              delay={index * 100}
            >
              <span className="landing-pillar-tag">{pillar.tag}</span>
              <h3>{pillar.title}</h3>
              <p>{pillar.text}</p>
              <ul>
                {pillar.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </RevealOnScroll>
          ))}
        </div>
      </section>

      <section className="landing-section" id="banking">
        <RevealOnScroll className="landing-section-head">
          <p className="landing-eyebrow">Agency banking</p>
          <h2>Role desks for tellers, back office, finance, and HR</h2>
          <p className="muted landing-section-sub">
            Collapsible sidebar groups keep each job title focused—deposits and withdrawals at the counter, bank
            execution in back office, trial balance and approvals for accountants, and exception review for auditors.
          </p>
        </RevealOnScroll>
        <div className="landing-feature-grid">
          {bankingDesks.map((desk, index) => (
            <RevealOnScroll key={desk.title} as="article" className="landing-feature-card" delay={index * 50}>
              <div className="landing-feature-card__head">
                <span className="landing-feature-icon" aria-hidden>
                  {desk.icon}
                </span>
              </div>
              <h3>{desk.title}</h3>
              <p>{desk.text}</p>
            </RevealOnScroll>
          ))}
        </div>
      </section>

      <section className="landing-section landing-section--alt" id="universal-ops">
        <RevealOnScroll className="landing-section-head landing-section-head--center">
          <p className="landing-eyebrow">Universal Operations</p>
          <h2>Every staff member gets their own operations hub</h2>
          <p className="muted landing-section-sub">
            Not only managers—tellers, CS, coordinators, and back-office staff all see attendance, leave, internal
            announcements, policy documents, and incident reporting from the same sidebar.
          </p>
        </RevealOnScroll>
        <div className="landing-feature-grid">
          {universalOps.map((item, index) => (
            <RevealOnScroll key={item.title} as="article" className="landing-feature-card" delay={index * 50}>
              <div className="landing-feature-card__head">
                <span className="landing-feature-icon" aria-hidden>
                  {item.icon}
                </span>
                <span className="landing-feature-tag">Staff</span>
              </div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </RevealOnScroll>
          ))}
        </div>
      </section>

      <section className="landing-section landing-loans-spotlight" id="loans">
        <div className="landing-loans-spotlight__inner">
          <RevealOnScroll className="landing-loans-spotlight__copy">
            <p className="landing-eyebrow">Loans department</p>
            <h2>Group solidarity lending built for real cooperatives</h2>
            <p className="muted">
              Register loan groups with officers and members, run credit assessment with guarantor and income details,
              and move applications through approval, disbursement, and repayment—with printable forms your staff can
              use in the field.
            </p>
            <ul className="landing-loans-checklist">
              <li>Individual and group solidarity products</li>
              <li>Weekly or monthly repayment schedules</li>
              <li>Permission-based access for coordinators and credit staff</li>
              <li>Portfolio overview with overdue installment visibility</li>
            </ul>
            <button
              type="button"
              className="button landing-cta-primary"
              onClick={() => {
                if (session?.accessToken && user) {
                  handlePrimaryCta();
                  return;
                }
                document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              {session?.accessToken && user ? "Open your workspace" : "Talk to us about loans"}
            </button>
          </RevealOnScroll>
          <div className="landing-loans-flow">
            {loanSpotlight.map((item, index) => (
              <RevealOnScroll key={item.title} as="article" className="landing-loans-flow__step" delay={index * 90}>
                <span className="landing-loans-flow__num">{item.step}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </RevealOnScroll>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section" id="features">
        <RevealOnScroll className="landing-section-head">
          <p className="landing-eyebrow">Platform capabilities</p>
          <h2>Everything your cooperative needs in one place</h2>
          <p className="muted landing-section-sub">
            From daily Susu in the field to accountant trial balance and staff incident reporting—BMS is designed for
            many branches, one member ledger, and teams who work on mobile as well as at the desk.
          </p>
        </RevealOnScroll>
        <div className="landing-feature-grid">
          {features.map((feature, index) => (
            <RevealOnScroll key={feature.title} as="article" className="landing-feature-card" delay={index * 50}>
              <div className="landing-feature-card__head">
                <span className="landing-feature-icon" aria-hidden>
                  {feature.icon}
                </span>
                {feature.tag ? <span className="landing-feature-tag">{feature.tag}</span> : null}
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </RevealOnScroll>
          ))}
        </div>
      </section>

      <section className="landing-section landing-section--alt" id="how-it-works">
        <RevealOnScroll className="landing-section-head">
          <p className="landing-eyebrow">How it works</p>
          <h2>From onboarding to daily collections, banking, and staff ops</h2>
        </RevealOnScroll>
        <ol className="landing-steps">
          {steps.map((step, index) => (
            <RevealOnScroll key={step.n} as="li" className="landing-step" delay={index * 100}>
              <span className="landing-step-num">{step.n}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </RevealOnScroll>
          ))}
        </ol>
      </section>

      <section className="landing-section" id="roles">
        <RevealOnScroll className="landing-section-head">
          <p className="landing-eyebrow">Who uses BMS</p>
          <h2>Built for every layer of your organization</h2>
          <p className="muted landing-section-sub">
            Role-based desks and permissions put the right tools in front of each team—without exposing internal
            platform administration to branch staff.
          </p>
        </RevealOnScroll>
        <div className="landing-roles-grid">
          {roles.map((item, index) => (
            <RevealOnScroll key={item.title} as="article" className="landing-role-card" delay={index * 80}>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </RevealOnScroll>
          ))}
        </div>
      </section>

      <section className="landing-section" id="contact">
        <RevealOnScroll className="landing-section-head">
          <p className="landing-eyebrow">Contact</p>
          <h2>Ready to modernize your cooperative?</h2>
          <p className="muted landing-section-sub">
            Tell us about your branches, Susu volume, agency banking partners, and lending plans. Use live chat
            (bottom right) or email—we will help you evaluate BMS for your organization.
          </p>
        </RevealOnScroll>
        <RevealOnScroll className="landing-contact-card card" delay={120}>
          <p>
            <strong>Email:</strong>{" "}
            <a href={`mailto:${BMS_CONTACT_EMAIL}`}>{BMS_CONTACT_EMAIL}</a>
          </p>
          <p className="muted">
            BMS — Banking Management System for cooperatives and MFIs. Susu collections, agency banking desks,
            Universal Operations for staff, credit products, and finance control in one secure workspace.
          </p>
        </RevealOnScroll>
      </section>

      <RevealOnScroll as="section" className="landing-section landing-cta-band">
        <div>
          <h2>Start with savings. Scale into banking and staff operations.</h2>
          <p className="muted">
            Sign in with credentials from your administrator, or contact us to register your cooperative on BMS.
          </p>
        </div>
        <Link to="/login" className="button landing-cta-primary">
          Sign in
        </Link>
      </RevealOnScroll>

      <footer className="landing-footer">
        <p>
          <strong>BMS</strong> — Banking Management System for cooperative &amp; MFI operations.
        </p>
        <p className="muted">
          Contact: <a href={`mailto:${BMS_CONTACT_EMAIL}`}>{BMS_CONTACT_EMAIL}</a>
        </p>
        <p className="muted">
          Multi-tenant · Susu &amp; agency banking · Universal Operations · Live sync · Audit-friendly
        </p>
      </footer>

      <LiveChatWidget />
    </div>
  );
}
