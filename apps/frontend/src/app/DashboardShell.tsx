import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import type { DashboardNavChild, DashboardNavItem } from "../config/tenantModules";
import { getNavIcon } from "./navIcons";
import { BmsBrandIcon } from "../components/BmsBrandIcon";
import { AiHelpPanel } from "../components/AiHelpPanel";
import { GlobalSearch } from "./components/GlobalSearch";
import { DashboardNotifications } from "./components/DashboardNotifications";
import { DashboardLoadingBar } from "./components/DashboardLoadingBar";
import { ThemeToggle } from "../components/ThemeToggle";
import { InstallAppButton } from "../pwa/InstallAppButton";
import { useDashboardPageLoading } from "./hooks/useDashboardPageLoading";
import { brandColorStyle } from "./brandColor";

export type { DashboardNavItem };

type Props = {
  workspaceSubtitle: string;
  navItems: DashboardNavItem[];
  companyName?: string;
  companyLogoUrl?: string;
  brandColor?: string;
  userName: string;
  userRole: string;
  userInitials?: string;
  canSearchCustomers?: boolean;
  canSearchUsers?: boolean;
  notificationsEnabled?: boolean;
  onLogout: () => void;
  topbarActions?: ReactNode;
  children: ReactNode;
};

function pathMatchesRoute(currentPath: string, navTo: string): boolean {
  const normalized = navTo.replace(/^\/+/, "").replace(/^app\//, "");
  const target = `/app/${normalized}`;
  return currentPath === target || currentPath.endsWith(target);
}

function childIsActive(currentPath: string, child: DashboardNavChild): boolean {
  if (child.kind === "link") {
    return pathMatchesRoute(currentPath, child.to);
  }
  return child.children.some((sub) => pathMatchesRoute(currentPath, sub.to));
}

function groupIsActive(currentPath: string, item: Extract<DashboardNavItem, { kind: "group" }>): boolean {
  return item.children.some((child) => childIsActive(currentPath, child));
}

function subgroupIsActive(currentPath: string, child: Extract<DashboardNavChild, { kind: "subgroup" }>): boolean {
  return child.children.some((sub) => pathMatchesRoute(currentPath, sub.to));
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? "U").toUpperCase();
}

export function DashboardShell({
  workspaceSubtitle,
  navItems,
  companyName,
  companyLogoUrl,
  brandColor,
  userName,
  userRole,
  userInitials,
  canSearchCustomers = false,
  canSearchUsers = false,
  notificationsEnabled = false,
  onLogout,
  topbarActions,
  children
}: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const [openSubgroups, setOpenSubgroups] = useState<Set<string>>(() => new Set());
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [currentPath]);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMobileNavOpen(false);
      }
    }
    const mq = window.matchMedia("(min-width: 981px)");
    function onMediaChange(e: MediaQueryListEvent) {
      if (e.matches) {
        setMobileNavOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    mq.addEventListener("change", onMediaChange);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
      mq.removeEventListener("change", onMediaChange);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const activeGroups = new Set<string>();
    const activeSubgroups = new Set<string>();
    for (const item of navItems) {
      if (item.kind !== "group") {
        continue;
      }
      if (groupIsActive(currentPath, item)) {
        activeGroups.add(item.id);
      }
      for (const child of item.children) {
        if (child.kind === "subgroup" && subgroupIsActive(currentPath, child)) {
          activeGroups.add(item.id);
          activeSubgroups.add(child.id);
        }
      }
    }
    if (activeGroups.size > 0) {
      setOpenGroups((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const id of activeGroups) {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
    if (activeSubgroups.size > 0) {
      setOpenSubgroups((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const id of activeSubgroups) {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [currentPath, navItems]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!profileRef.current?.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSubgroup(id: string) {
    setOpenSubgroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const initials = userInitials ?? initialsFromName(userName);
  const pageLoading = useDashboardPageLoading();

  return (
    <div
      className="dash-root"
      style={
        brandColor ? brandColorStyle(brandColor) : undefined
      }
    >
      {mobileNavOpen ? (
        <div
          className="dash-sidebar-backdrop"
          aria-hidden="true"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside
        className={`dash-sidebar${mobileNavOpen ? " is-mobile-open" : ""}`}
        aria-label="Main navigation"
      >
        <div className="dash-brand">
          <div className="dash-brand-title-row">
            {companyLogoUrl ? (
              <div className="dash-brand-icon dash-brand-icon--logo" aria-hidden>
                <img src={companyLogoUrl} alt="" />
              </div>
            ) : (
              <BmsBrandIcon />
            )}
            <p className="dash-brand-name">aabanker</p>
            <button
              type="button"
              className="dash-sidebar-close"
              aria-label="Close navigation menu"
              onClick={() => setMobileNavOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="dash-brand-text">
            {companyName ? <p className="dash-brand-company">{companyName}</p> : null}
          </div>
        </div>

        <nav className="dash-nav">
          {navItems.map((item) => {
            if (item.kind === "link") {
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={item.label}
                  aria-label={item.label}
                  onClick={() => setMobileNavOpen(false)}
                  className={({ isActive }) => `dash-nav-link${isActive ? " active" : ""}`}
                >
                  <span className="dash-nav-icon" aria-hidden>
                    {getNavIcon(item.label, item.to)}
                  </span>
                  <span className="dash-nav-label">{item.label}</span>
                </NavLink>
              );
            }

            const isOpen = openGroups.has(item.id);
            const isActiveGroup = groupIsActive(currentPath, item);

            return (
              <div
                key={item.id}
                className={`dash-nav-group${item.flatChildren ? " dash-nav-group--flat" : ""}${isOpen ? " is-open" : ""}${isActiveGroup ? " has-active" : ""}`}
              >
                <button
                  type="button"
                  className="dash-nav-group-trigger"
                  aria-expanded={isOpen}
                  title={item.label}
                  aria-label={item.label}
                  onClick={() => toggleGroup(item.id)}
                >
                  <span className="dash-nav-icon" aria-hidden>
                    {getNavIcon(item.label)}
                  </span>
                  <span className="dash-nav-group-label">{item.label}</span>
                  <span className={`dash-nav-chevron${isOpen ? " is-open" : ""}`} aria-hidden>
                    ▸
                  </span>
                </button>
                <div className="dash-nav-children" aria-hidden={!isOpen}>
                  <div className="dash-nav-children-inner">
                    {item.children.map((child) => {
                      if (child.kind === "link") {
                        return (
                          <NavLink
                            key={child.to}
                            to={child.to}
                            title={child.label}
                            aria-label={child.label}
                            onClick={() => setMobileNavOpen(false)}
                            className={({ isActive }) => `dash-nav-sublink${isActive ? " active" : ""}`}
                          >
                            <span className="dash-nav-sublink-icon" aria-hidden>
                              {getNavIcon(child.label, child.to)}
                            </span>
                            <span className="dash-nav-label">{child.label}</span>
                          </NavLink>
                        );
                      }
                      const subOpen = openSubgroups.has(child.id);
                      const subActive = subgroupIsActive(currentPath, child);
                      return (
                        <div
                          key={child.id}
                          className={`dash-nav-subgroup${subOpen ? " is-open" : ""}${subActive ? " has-active" : ""}`}
                        >
                          <button
                            type="button"
                            className="dash-nav-subgroup-trigger"
                            aria-expanded={subOpen}
                            title={child.label}
                            aria-label={child.label}
                            onClick={() => toggleSubgroup(child.id)}
                          >
                            <span className="dash-nav-sublink-icon" aria-hidden>
                              {getNavIcon(child.label)}
                            </span>
                            <span className="dash-nav-subgroup-label">{child.label}</span>
                            <span className={`dash-nav-chevron dash-nav-chevron--nested${subOpen ? " is-open" : ""}`} aria-hidden>
                              ▸
                            </span>
                          </button>
                          <div className="dash-nav-subchildren" aria-hidden={!subOpen}>
                            <div className="dash-nav-subchildren-inner">
                              {child.children.map((sub) => (
                                <NavLink
                                  key={sub.to}
                                  to={sub.to}
                                  title={sub.label}
                                  aria-label={sub.label}
                                  onClick={() => setMobileNavOpen(false)}
                                  className={({ isActive }) =>
                                    `dash-nav-sublink dash-nav-sublink--nested${isActive ? " active" : ""}`
                                  }
                                >
                                  <span className="dash-nav-sublink-icon" aria-hidden>
                                    {getNavIcon(sub.label, sub.to)}
                                  </span>
                                  <span className="dash-nav-label">{sub.label}</span>
                                </NavLink>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        <div className="dash-sidebar-promo">
          <p className="dash-promo-title">Cooperative operations</p>
          <p className="dash-promo-text">{workspaceSubtitle}</p>
        </div>
      </aside>

      <div className="dash-main">
        <div className="dash-header-shell">
          <header className="dash-header">
            <div className="dash-header-start">
              <button
                type="button"
                className="dash-mobile-menu-btn"
                aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
                aria-expanded={mobileNavOpen}
                onClick={() => setMobileNavOpen((open) => !open)}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 7h16M4 12h16M4 17h16"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <GlobalSearch canSearchCustomers={canSearchCustomers} canSearchUsers={canSearchUsers} />
            </div>

            {topbarActions ? <div className="dash-header-center">{topbarActions}</div> : null}

            <div className="dash-header-end">
              <ThemeToggle />
              <DashboardNotifications enabled={notificationsEnabled} />

              <div className={`dash-profile-menu${profileOpen ? " is-open" : ""}`} ref={profileRef}>
              <button
                type="button"
                className="dash-profile-trigger"
                aria-expanded={profileOpen}
                aria-haspopup="menu"
                onClick={() => setProfileOpen((v) => !v)}
              >
                <span className="dash-profile-avatar" aria-hidden>
                  {initials}
                </span>
                <span className="dash-profile-label">
                  <span className="dash-profile-name">{userName}</span>
                  <span className="dash-profile-role muted">{userRole}</span>
                </span>
                <span className="dash-profile-chevron" aria-hidden>
                  ▸
                </span>
              </button>
              {profileOpen ? (
                <div className="dash-profile-panel dash-panel-enter" role="menu">
                  <Link
                    className="dash-profile-panel__item"
                    role="menuitem"
                    to="/app/profile"
                    onClick={() => setProfileOpen(false)}
                  >
                    <span aria-hidden>👤</span> My profile
                  </Link>
                  <Link
                    className="dash-profile-panel__item"
                    role="menuitem"
                    to="/app/profile#payslip"
                    onClick={() => setProfileOpen(false)}
                  >
                    <span aria-hidden>🧾</span> Payslip
                  </Link>
                  <Link
                    className="dash-profile-panel__item"
                    role="menuitem"
                    to="/app/profile#password"
                    onClick={() => setProfileOpen(false)}
                  >
                    <span aria-hidden>🔑</span> Change password
                  </Link>
                  <button
                    type="button"
                    className="dash-profile-panel__item"
                    role="menuitem"
                    onClick={() => {
                      setProfileOpen(false);
                      navigate("/app/profile#role");
                    }}
                  >
                    <span aria-hidden>⚙</span> Role &amp; permissions
                  </button>
                  <ThemeToggle className="theme-toggle theme-toggle--menu" showLabel />
                  <InstallAppButton
                    variant="menu"
                    onInstalled={() => setProfileOpen(false)}
                  />
                  <div className="dash-profile-panel__divider" role="separator" />
                  <button
                    type="button"
                    className="dash-profile-panel__item dash-profile-panel__item--logout"
                    role="menuitem"
                    onClick={() => {
                      setProfileOpen(false);
                      onLogout();
                    }}
                  >
                    <span aria-hidden>⎋</span> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
          <DashboardLoadingBar active={pageLoading} />
        </div>

        <section className="dash-content">{children}</section>
      </div>
      <AiHelpPanel />
    </div>
  );
}
