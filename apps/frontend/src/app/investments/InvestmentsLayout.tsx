import type { ReactNode } from "react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { filterInvestmentsNavByPermissions, type InvestmentsNavKey } from "@bms/shared";
import { useAuth } from "../../auth/AuthContext";
import { useInvestmentsLiveSync } from "../hooks/useInvestmentsLiveSync";

type Props = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  activeNav?: InvestmentsNavKey;
};

export function InvestmentsLayout({ title, subtitle, actions, children, activeNav }: Props) {
  useInvestmentsLiveSync();
  const { user } = useAuth();
  const navItems = useMemo(
    () => filterInvestmentsNavByPermissions(user?.permissions),
    [user?.permissions]
  );

  return (
    <div className="investments-module overview-page">
      <header className="overview-hero">
        <div>
          <p className="overview-hero__eyebrow">Investment management</p>
          <h1 className="overview-hero__title">{title}</h1>
          {subtitle ? <p className="overview-hero__sub muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="investments-hero-actions">{actions}</div> : null}
      </header>

      {navItems.length > 0 ? (
        <nav className="investments-subnav" aria-label="Investment sections">
          {navItems.map((item) => (
            <Link
              key={item.navKey}
              to={`/app/${item.navPath}`}
              className={`investments-subnav__link${activeNav === item.navKey ? " investments-subnav__link--active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="investments-body">{children}</div>
    </div>
  );
}
