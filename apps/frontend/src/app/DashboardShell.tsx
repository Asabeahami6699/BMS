import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import type { DashboardNavChild, DashboardNavItem } from "../config/tenantModules";
import { getNavIcon } from "./navIcons";
import { BmsBrandIcon } from "../components/BmsBrandIcon";
import { AiHelpPanel } from "../components/AiHelpPanel";
import { GlobalSearch } from "./components/GlobalSearch";
import { DashboardNotifications } from "./components/DashboardNotifications";
import { ThemeToggle } from "../components/ThemeToggle";

export type { DashboardNavItem };

type Props = {
  workspaceSubtitle: string;
  navItems: DashboardNavItem[];
  companyName?: string;
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
  const profileRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="dash-root">
      <aside className="dash-sidebar">
        <div className="dash-brand">
          <div className="dash-brand-title-row">
            <BmsBrandIcon />
            <p className="dash-brand-name">BMS</p>
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
                  className={({ isActive }) => `dash-nav-link${isActive ? " active" : ""}`}
                >
                  <span className="dash-nav-icon" aria-hidden>
                    {getNavIcon(item.label, item.to)}
                  </span>
                  <span>{item.label}</span>
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
                            className={({ isActive }) => `dash-nav-sublink${isActive ? " active" : ""}`}
                          >
                            <span className="dash-nav-sublink-icon" aria-hidden>
                              {getNavIcon(child.label, child.to)}
                            </span>
                            {child.label}
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
                                  className={({ isActive }) =>
                                    `dash-nav-sublink dash-nav-sublink--nested${isActive ? " active" : ""}`
                                  }
                                >
                                  <span className="dash-nav-sublink-icon" aria-hidden>
                                    {getNavIcon(sub.label, sub.to)}
                                  </span>
                                  {sub.label}
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
        <header className="dash-header">
          <div className="dash-header-start">
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

        <section className="dash-content">{children}</section>
      </div>
      <AiHelpPanel />
    </div>
  );
}
