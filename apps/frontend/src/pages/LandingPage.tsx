import { Link, useNavigate } from "react-router-dom";
import { BMS_CONTACT_EMAIL } from "../app/chatApi";
import { getAuthSession } from "../app/api";
import { useAuth } from "../auth/AuthContext";
import { getHomePathForRole } from "../auth/roleRedirect";
import { LiveChatWidget } from "../components/LiveChatWidget";
import { RevealOnScroll } from "../components/RevealOnScroll";

const features = [
  {
    icon: "🏢",
    title: "Multi-tenant SaaS",
    text: "One platform hosts many cooperatives and MFIs. Each company gets an isolated workspace with its own branches, users, and policies."
  },
  {
    icon: "⌂",
    title: "Branches & head office",
    text: "Run head-office control with branch-scoped field staff. Mobilizers and Susu coordinators operate where members actually save."
  },
  {
    icon: "◎",
    title: "Single customer ledger",
    text: "Members keep one balance across branches—deposit or withdraw at any branch without splitting accounts."
  },
  {
    icon: "⇄",
    title: "Daily Susu & transactions",
    text: "Record daily Susu, deposits, and withdrawals with idempotent posting, audit trails, and real-time balance updates."
  },
  {
    icon: "%",
    title: "Commission policies",
    text: "Configure field-agent and coordinator commission rules per tenant—percentages, basis, and bonus thresholds."
  },
  {
    icon: "₵",
    title: "Payroll & payslips",
    text: "Run payroll cycles and deliver payslips to every role; commission lines appear only where they apply."
  },
  {
    icon: "▤",
    title: "Reports & exports",
    text: "Summary, agent, and branch performance views with CSV export for reconciliation and supervision."
  },
  {
    icon: "⚙",
    title: "Flexible roles & duties",
    text: "Admins define custom roles and assign duties—teller, auditor, accountant, customer service, and more."
  }
];

const roles = [
  {
    title: "Platform super admin",
    text: "Registers companies on BMS, creates company admins, and toggles subscriptions active or inactive."
  },
  {
    title: "Company admin",
    text: "Sets up branches, users, commission policy, and roles—the control center for each cooperative."
  },
  {
    title: "Field agent & coordinator",
    text: "Onboards customers and posts collections at the branch with scope-safe, branch-aware permissions."
  },
  {
    title: "Finance & audit staff",
    text: "Reviews ledgers, runs reports, processes payroll, and exports data without touching day-to-day collections."
  }
];

const steps = [
  { n: "01", title: "Register your cooperative", text: "Your platform admin onboards your organization as a tenant on BMS." },
  { n: "02", title: "Configure branches & policy", text: "Company admins create branches, commission rules, and staff accounts." },
  { n: "03", title: "Collect in the field", text: "Agents and coordinators record Susu and transactions with full audit history." },
  { n: "04", title: "Report & pay", text: "Head office monitors performance, exports reports, and runs payroll with payslips." }
];

const highlights = [
  { value: "1 ledger", label: "Per member, all branches" },
  { value: "Realtime", label: "Live updates where configured" },
  { value: "RLS-ready", label: "Tenant isolation by design" },
  { value: "Role-based", label: "Least-privilege access" }
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
          <span className="dash-brand-icon" aria-hidden>
            B
          </span>
          <span>
            <strong>BMS</strong>
            <small>Banking Management System</small>
          </span>
        </Link>

        <nav className="landing-nav-links" aria-label="Primary">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#roles">Who uses BMS</a>
          <a href="#highlights">Why BMS</a>
          <a href="#contact">Contact</a>
        </nav>

        <div className="landing-nav-actions">
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
                Sign in to workspace
              </button>
            </>
          )}
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow landing-animate-in landing-animate-in--1">Built for Susu, cooperatives & MFIs</p>
          <h1 className="landing-animate-in landing-animate-in--2">
            Run savings groups and branch networks on <span className="landing-gradient-text">one modern platform</span>
          </h1>
          <p className="landing-lead landing-animate-in landing-animate-in--3">
            BMS (Banking Management System) helps multi-branch cooperatives manage members, daily Susu collections,
            cross-branch deposits and withdrawals, commissions, payroll, and supervision—from field agent to head office.
          </p>
          <div className="landing-hero-cta landing-animate-in landing-animate-in--4">
            <button type="button" className="button landing-cta-primary" onClick={handlePrimaryCta}>
              {session?.accessToken && user ? "Open your dashboard" : "Sign in"}
            </button>
            <a href="#features" className="button secondary landing-cta-secondary">
              Explore features
            </a>
          </div>
          <p className="landing-hero-note muted landing-animate-in landing-animate-in--5">
            Secure sign-in with credentials from your company or platform administrator.
          </p>
        </div>

        <div className="landing-hero-panel landing-animate-in--panel" aria-hidden>
          <div className="landing-mock-card landing-animate-in landing-animate-in--6">
            <p className="landing-mock-label">Today&apos;s collections</p>
            <p className="landing-mock-value">GH₵ 128,450</p>
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
            <p className="landing-mock-label">Active branches</p>
            <p className="landing-mock-value">12</p>
          </div>
          <div className="landing-mock-card landing-mock-card--small landing-mock-card--accent landing-animate-in landing-animate-in--8">
            <p className="landing-mock-label">Members served</p>
            <p className="landing-mock-value">4,820</p>
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

      <section className="landing-section" id="features">
        <RevealOnScroll className="landing-section-head">
          <p className="landing-eyebrow">Platform capabilities</p>
          <h2>Everything your cooperative needs in one place</h2>
          <p className="muted landing-section-sub">
            BMS is designed for real-world Susu operations: many tenants, many branches, one member ledger, and staff
            who work in the field—not only at a desk.
          </p>
        </RevealOnScroll>
        <div className="landing-feature-grid">
          {features.map((feature, index) => (
            <RevealOnScroll key={feature.title} as="article" className="landing-feature-card" delay={index * 60}>
              <span className="landing-feature-icon" aria-hidden>
                {feature.icon}
              </span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </RevealOnScroll>
          ))}
        </div>
      </section>

      <section className="landing-section landing-section--alt" id="how-it-works">
        <RevealOnScroll className="landing-section-head">
          <p className="landing-eyebrow">How it works</p>
          <h2>From platform onboarding to daily collections</h2>
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
          <h2>Questions about registration?</h2>
          <p className="muted landing-section-sub">
            Use the live chat button (bottom right) to talk with our platform team, or email us directly.
          </p>
        </RevealOnScroll>
        <RevealOnScroll className="landing-contact-card card" delay={120}>
          <p>
            <strong>Email:</strong>{" "}
            <a href={`mailto:${BMS_CONTACT_EMAIL}`}>{BMS_CONTACT_EMAIL}</a>
          </p>
          <p className="muted">
            BMS — Banking Management System. We help cooperatives and MFIs register, onboard branches, and run Susu
            operations at scale.
          </p>
        </RevealOnScroll>
      </section>

      <RevealOnScroll as="section" className="landing-section landing-cta-band">
        <div>
          <h2>Ready to sign in?</h2>
          <p className="muted">
            Use the email and password your administrator created for you. Company staff go to the company dashboard;
            platform operators use the super admin workspace.
          </p>
        </div>
        <Link to="/login" className="button landing-cta-primary">
          Sign in
        </Link>
      </RevealOnScroll>

      <footer className="landing-footer">
        <p>
          <strong>BMS</strong> — Banking Management System for cooperative &amp; MFI Susu operations.
        </p>
        <p className="muted">
          Contact: <a href={`mailto:${BMS_CONTACT_EMAIL}`}>{BMS_CONTACT_EMAIL}</a>
        </p>
        <p className="muted">Multi-tenant · Branch-aware · Audit-friendly · Role-based access</p>
      </footer>

      <LiveChatWidget />
    </div>
  );
}
