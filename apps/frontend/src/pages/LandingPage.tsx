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
  "Daily Susu collections",
  "Cross-branch ledger",
  "Credit & group loans",
  "Live dashboard sync"
];

const pillars = [
  {
    tag: "Savings",
    title: "Susu & member accounts",
    text: "Daily collections, deposits, withdrawals, and a single balance per member across every branch.",
    points: ["Field agent posting", "Idempotent transactions", "Customer CIF & photos"]
  },
  {
    tag: "Lending",
    title: "Credit department",
    text: "Individual and group solidarity loans with products, approval workflows, disbursement, and repayments.",
    points: ["Credit assessment forms", "Solidarity groups", "Printable applications"],
    highlight: true
  },
  {
    tag: "Operations",
    title: "Back office & control",
    text: "Commissions, payroll, audit trails, role-based permissions, and exports for supervision.",
    points: ["Custom roles & duties", "Commission policies", "CSV reports"]
  }
];

const features = [
  {
    icon: "🏢",
    title: "Multi-tenant SaaS",
    text: "One platform hosts many cooperatives and MFIs. Each tenant gets an isolated workspace with branches, users, and subscribed products.",
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
    text: "Record daily Susu, deposits, and withdrawals with idempotent posting, audit trails, and real-time balance updates.",
    tag: null
  },
  {
    icon: "💳",
    title: "Loans & credit products",
    text: "Configure interest rates, terms, and weekly or monthly schedules. Track portfolio KPIs from application to full repayment.",
    tag: "New"
  },
  {
    icon: "👥",
    title: "Group solidarity lending",
    text: "Register loan groups with chairs, treasurers, and members. Apply on behalf of a member using group solidarity products.",
    tag: "New"
  },
  {
    icon: "📋",
    title: "Credit assessment & documents",
    text: "Capture income, occupation, loan purpose, guarantor details, passport and ID photos—with printable review forms.",
    tag: "New"
  },
  {
    icon: "⌂",
    title: "Branches & head office",
    text: "Run head-office control with branch-scoped field staff. Mobilizers and coordinators operate where members actually save.",
    tag: null
  },
  {
    icon: "%",
    title: "Commission policies",
    text: "Configure field-agent and coordinator commission rules per tenant—percentages, basis, and bonus thresholds.",
    tag: null
  },
  {
    icon: "▤",
    title: "Reports & exports",
    text: "Summary, agent, branch, and loans performance views with CSV export for reconciliation and supervision.",
    tag: null
  },
  {
    icon: "⚡",
    title: "Live sync dashboards",
    text: "Susu and loans modules hydrate fast and refresh quietly in the background so supervisors always see current figures.",
    tag: null
  },
  {
    icon: "🔐",
    title: "Permission-driven access",
    text: "Admins assign granular duties—read loans, approve applications, disburse, collect repayments—without hard-coded roles.",
    tag: null
  },
  {
    icon: "₵",
    title: "Payroll & payslips",
    text: "Run payroll cycles and deliver payslips to every role; commission lines appear only where they apply.",
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
    title: "Platform super admin",
    text: "Registers companies on BMS, enables product subscriptions, and manages tenant lifecycle."
  },
  {
    title: "Company admin",
    text: "Sets up branches, users, commission policy, loan products, and custom roles—the control center for each cooperative."
  },
  {
    title: "Field agent & coordinator",
    text: "Onboards customers, posts Susu collections, and—with the right permissions—submits loan applications in the field."
  },
  {
    title: "Credit & finance staff",
    text: "Reviews applications, approves or declines credit, disburses loans, records repayments, and exports portfolio reports."
  }
];

const steps = [
  {
    n: "01",
    title: "Register your cooperative",
    text: "Your platform admin onboards your organization as a tenant with the products you need—Susu, loans, or both."
  },
  {
    n: "02",
    title: "Configure branches & products",
    text: "Company admins create branches, commission rules, loan products, solidarity groups, and staff accounts."
  },
  {
    n: "03",
    title: "Collect & lend in the field",
    text: "Agents record Susu and transactions; authorized staff submit individual or group loan applications with full documentation."
  },
  {
    n: "04",
    title: "Supervise, report & pay",
    text: "Head office monitors live KPIs, manages the loan portfolio, exports reports, and runs payroll with payslips."
  }
];

const highlights = [
  { value: "Susu + Loans", label: "One platform, two revenue lines" },
  { value: "Live sync", label: "Fresh data without manual refresh" },
  { value: "RLS-ready", label: "Tenant isolation by design" },
  { value: "Audit-friendly", label: "Every posting traceable" }
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
          <a href="#loans">Loans</a>
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
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
            Savings, credit & supervision for cooperatives
          </p>
          <h1 className="landing-animate-in landing-animate-in--2">
            Grow members with Susu today and{" "}
            <span className="landing-gradient-text">responsible lending tomorrow</span>
          </h1>
          <p className="landing-lead landing-animate-in landing-animate-in--3">
            BMS is a modern Banking Management System for multi-branch cooperatives and MFIs—daily Susu collections,
            cross-branch deposits, a full credit department with group solidarity loans, commissions, payroll, and
            live dashboards from field agent to head office.
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
            <a href="#platform" className="button secondary landing-cta-secondary">
              See the platform
            </a>
          </div>
          <p className="landing-hero-note muted landing-animate-in landing-animate-in--6">
            New to BMS? Chat with our team or email us—we help cooperatives register and go live quickly.
          </p>
        </div>

        <div className="landing-hero-panel landing-animate-in--panel" aria-hidden>
          <div className="landing-mock-card landing-animate-in landing-animate-in--6">
            <p className="landing-mock-label">Today&apos;s Susu collections</p>
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
            <p className="landing-mock-label">Loan portfolio</p>
            <p className="landing-mock-value">GH₵ 2.4M</p>
            <p className="landing-mock-meta">38 active loans</p>
          </div>
          <div className="landing-mock-card landing-mock-card--small landing-mock-card--accent landing-animate-in landing-animate-in--8">
            <p className="landing-mock-label">Pending approval</p>
            <p className="landing-mock-value">7</p>
            <p className="landing-mock-meta">3 group applications</p>
          </div>
          <div className="landing-mock-card landing-mock-card--wide landing-animate-in landing-animate-in--8">
            <div className="landing-mock-row">
              <span className="landing-mock-pill landing-mock-pill--success">Disbursed</span>
              <span className="landing-mock-pill">Group solidarity</span>
              <span className="landing-mock-pill landing-mock-pill--warn">Due this week</span>
            </div>
            <p className="landing-mock-caption">Loans department · live portfolio sync</p>
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
          <p className="landing-eyebrow">Three pillars, one workspace</p>
          <h2>Savings operations and lending on the same member ledger</h2>
          <p className="muted landing-section-sub">
            Most cooperatives start with Susu. When you are ready to lend, BMS adds a credit department without
            replacing your existing workflows or splitting customer data.
          </p>
        </RevealOnScroll>
        <div className="landing-pillar-grid">
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
              {session?.accessToken && user ? "Open loans workspace" : "Talk to us about loans"}
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
            From daily Susu in the field to loan approvals at head office—BMS is designed for many tenants, many
            branches, one member ledger, and staff who work on mobile—not only at a desk.
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
          <h2>From platform onboarding to daily collections and lending</h2>
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
          <h2>Ready to modernize your cooperative?</h2>
          <p className="muted landing-section-sub">
            Tell us about your branches, Susu volume, and lending plans. Use live chat (bottom right) or email—we will
            help you evaluate BMS for your organization.
          </p>
        </RevealOnScroll>
        <RevealOnScroll className="landing-contact-card card" delay={120}>
          <p>
            <strong>Email:</strong>{" "}
            <a href={`mailto:${BMS_CONTACT_EMAIL}`}>{BMS_CONTACT_EMAIL}</a>
          </p>
          <p className="muted">
            BMS — Banking Management System for cooperatives and MFIs. Susu collections, cross-branch savings, credit
            products, group solidarity loans, commissions, and payroll in one secure workspace.
          </p>
        </RevealOnScroll>
      </section>

      <RevealOnScroll as="section" className="landing-section landing-cta-band">
        <div>
          <h2>Start with savings. Scale into lending.</h2>
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
          Multi-tenant · Susu &amp; loans · Live sync · Audit-friendly · Permission-based access
        </p>
      </footer>

      <LiveChatWidget />
    </div>
  );
}
