import type { ReactNode } from "react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { filterLoansNavByPermissions, type LoansNavKey } from "@bms/shared";
import { useAuth } from "../../auth/AuthContext";
import { useLoansLiveSync } from "../hooks/useLoansLiveSync";

type Props = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  activeNav?: LoansNavKey;
};

export function LoansLayout({ title, subtitle, actions, children, activeNav }: Props) {
  useLoansLiveSync();
  const { user } = useAuth();
  const navItems = useMemo(
    () =>
      filterLoansNavByPermissions(user?.permissions).filter((row) => row.navKey !== "applyGroup"),
    [user?.permissions]
  );

  return (
    <div className="loans-module">
      <header className="loans-hero loans-animate-in">
        <div className="loans-hero__glow" aria-hidden />
        <div className="loans-hero__content">
          <p className="loans-hero__eyebrow">Loans department</p>
          <h2>{title}</h2>
          {subtitle ? <p className="loans-hero__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="loans-hero__actions">{actions}</div> : null}
      </header>

      {navItems.length > 0 ? (
        <nav className="loans-subnav loans-animate-in loans-animate-in--2" aria-label="Loans sections">
          {navItems.map((item) => (
            <Link
              key={item.navKey}
              to={`/app/${item.navPath}`}
              className={`loans-subnav__link${activeNav === item.navKey ? " loans-subnav__link--active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="loans-body">{children}</div>
    </div>
  );
}
