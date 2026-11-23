import { FormEvent, useEffect, useId, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { API_BASE_URL, getAuthSession, lookupCompanyHost } from "../app/api";
import { brandColorStyle } from "../app/brandColor";
import { useAuth } from "../auth/AuthContext";
import { getHomePathForRole } from "../auth/roleRedirect";
import { parseTenantSubdomain } from "@bms/shared";
import { BmsBrandIcon } from "../components/BmsBrandIcon";
import { ThemeToggle } from "../components/ThemeToggle";
import { applyDocumentBranding, resetDocumentBranding } from "../lib/documentBranding";
import { toUserFacingError } from "../lib/networkError";
import { InstallAppButton } from "../pwa/InstallAppButton";

function companyInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "CO";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const hintId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const hostSubdomain = parseTenantSubdomain(window.location.hostname);
  const [companyName, setCompanyName] = useState("");
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | undefined>(undefined);
  const [companyBrandColor, setCompanyBrandColor] = useState<string | undefined>(undefined);
  const [loadingCompany, setLoadingCompany] = useState(Boolean(hostSubdomain));
  const [unknownHost, setUnknownHost] = useState(false);

  const session = getAuthSession();
  const ownsHost =
    !hostSubdomain ||
    hostSubdomain === (user?.tenantSubdomain || "").toLowerCase() ||
    hostSubdomain === (user?.tenantId || "").toLowerCase();

  const isCompanyHost = Boolean(hostSubdomain && !unknownHost);

  const helpText = unknownHost
    ? "This company address is not set up yet."
    : hostSubdomain
      ? `Use the email and password for ${companyName || hostSubdomain}.`
      : "Use the email and password provided by your administrator.";

  useEffect(() => {
    if (!hostSubdomain) {
      setLoadingCompany(false);
      return;
    }
    let cancelled = false;
    setLoadingCompany(true);
    void lookupCompanyHost(hostSubdomain)
      .then((company) => {
        if (!cancelled) {
          setCompanyName(company.name);
          setCompanyLogoUrl(company.logoUrl);
          setCompanyBrandColor(company.brandColor);
          setUnknownHost(false);
          setLoadingCompany(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCompanyName("");
          setCompanyLogoUrl(undefined);
          setCompanyBrandColor(undefined);
          setUnknownHost(true);
          setLoadingCompany(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hostSubdomain]);

  useEffect(() => {
    if (!isCompanyHost) {
      resetDocumentBranding();
      return;
    }
    applyDocumentBranding({
      companyName: companyName || hostSubdomain || undefined,
      pagePrefix: "Sign in",
      logoUrl: companyLogoUrl,
      subdomain: hostSubdomain,
      apiBaseUrl: API_BASE_URL
    });
  }, [isCompanyHost, companyName, companyLogoUrl, hostSubdomain]);

  if (!submitting && session?.accessToken && user && ownsHost) {
    return <Navigate to={getHomePathForRole(user.role, user.subscribedModules)} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setStatus("");
    setHintOpen(false);

    if (unknownHost) {
      setStatus("This company address is not set up yet.");
      setSubmitting(false);
      return;
    }

    try {
      const homePath = await login(email.trim(), password);
      navigate(homePath, { replace: true });
    } catch (error) {
      setStatus(toUserFacingError(error, "Sign in failed. Check your email and password."));
      setSubmitting(false);
    }
  }

  const brandStyle = isCompanyHost && companyBrandColor ? brandColorStyle(companyBrandColor) : undefined;
  const displayCompanyName = companyName || (hostSubdomain ? hostSubdomain.toUpperCase() : "");

  return (
    <main
      className={`login-page${submitting ? " login-page--busy" : ""}${isCompanyHost ? " login-page--tenant" : ""}`}
      style={brandStyle}
    >
      <div className="login-theme-toggle">
        <ThemeToggle showLabel />
      </div>

      {!isCompanyHost ? (
        <p className="login-back">
          <Link to="/">← Back to aabanker home</Link>
        </p>
      ) : null}

      <section className="login-card">
        <div className="login-card__brand">
          {isCompanyHost ? (
            loadingCompany ? (
              <>
                <div className="login-card__logo-skeleton" aria-hidden="true" />
                <p className="dash-brand-name">{displayCompanyName}</p>
                <p className="dash-brand-tag">Loading workspace…</p>
              </>
            ) : (
              <>
                {companyLogoUrl ? (
                  <div className="login-card__logo">
                    <img src={companyLogoUrl} alt={`${displayCompanyName} logo`} />
                  </div>
                ) : (
                  <div
                    className="login-card__monogram"
                    aria-hidden="true"
                    style={companyBrandColor ? { background: companyBrandColor } : undefined}
                  >
                    <span>{companyInitials(displayCompanyName)}</span>
                  </div>
                )}
                <p className="dash-brand-name">{displayCompanyName}</p>
                <p className="dash-brand-tag">Staff &amp; Operations Portal</p>
              </>
            )
          ) : (
            <>
              <BmsBrandIcon />
              <p className="dash-brand-name">aabanker</p>
              <p className="dash-brand-tag">Banking Management System</p>
            </>
          )}
        </div>

        <div className="login-card__title-row">
          <h1>Sign in</h1>
          <div className="login-hint">
            <button
              type="button"
              className={`login-hint__btn${hintOpen ? " is-open" : ""}${unknownHost ? " is-warn" : ""}`}
              aria-label="Sign-in help"
              aria-expanded={hintOpen}
              aria-controls={hintId}
              disabled={submitting}
              onClick={() => setHintOpen((open) => !open)}
            >
              i
            </button>
            {hintOpen ? (
              <p id={hintId} className="login-hint__popup" role="status">
                {helpText}
              </p>
            ) : (
              <span id={hintId} className="sr-only">
                {helpText}
              </span>
            )}
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={submitting}
            />
          </label>

          <label className="field">
            <span>Password</span>
            <div className="field-password-wrap">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={submitting}
              />
              <button
                type="button"
                className="field-password-toggle"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                disabled={submitting}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M1 1l22 22" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </label>

          <button
            type="submit"
            className={`button login-submit${submitting ? " login-submit--loading" : ""}`}
            disabled={submitting || unknownHost}
            aria-busy={submitting}
          >
            <span className="login-submit__fill" aria-hidden />
            <span className="login-submit__label">{submitting ? "Signing in…" : "Sign in"}</span>
          </button>
        </form>

        {status ? <p className="login-status login-status--error">{status}</p> : null}

        <div className="login-install">
          <InstallAppButton variant="button" />
        </div>

        {isCompanyHost ? (
          <p className="login-card__powered">Powered by aabanker</p>
        ) : null}
      </section>
    </main>
  );
}
