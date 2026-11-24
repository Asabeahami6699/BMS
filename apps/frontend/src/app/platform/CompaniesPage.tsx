import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ADDON_LABELS,
  MODULE_LABELS,
  TENANT_ROOT_DOMAIN,
  isTenantSubdomain,
  tenantSignInHost
} from "@bms/shared";
import type { TenantRecord } from "../api";
import { updateTenantSubdomain, updateTenantSubscription } from "../api";
import { RowActionsMenu } from "../../components/RowActionsMenu";
import { useToast } from "../../components/Toast";
import { usePlatformAdminStore } from "../stores/platformAdminStore";
import { CreateAdminModal } from "./CreateAdminModal";
import { EditTenantAddonsModal } from "./EditTenantAddonsModal";
import { EditTenantModulesModal } from "./EditTenantModulesModal";
import { EditTenantProfileModal } from "./EditTenantProfileModal";
import { RegisterCompanyModal } from "./RegisterCompanyModal";
import { TenantCustomerSupportModal } from "./TenantCustomerSupportModal";
import { TerminateCompanyModal } from "./TerminateCompanyModal";

type StatusFilter = "all" | "active" | "inactive" | "open_tills";

function companyInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? "CO").toUpperCase();
}

function CompanyAddressField({
  tenant,
  onSaved
}: {
  tenant: TenantRecord;
  onSaved: (tenant: TenantRecord) => void;
}) {
  const { showToast } = useToast();
  const current = tenant.subdomain || (isTenantSubdomain(tenant.id) ? tenant.id : "");
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(current);
  }, [current]);

  const trimmed = value.trim().toLowerCase();
  const dirty = trimmed !== current.toLowerCase();

  async function save() {
    if (!trimmed) return;
    setSaving(true);
    try {
      const saved = await updateTenantSubdomain(tenant.id, trimmed);
      onSaved(saved);
      showToast(`Saved ${tenantSignInHost(saved.subdomain || trimmed)}`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save web address", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="platform-company-address">
      <div className="platform-company-address__input-group">
        <input
          value={value}
          aria-label={`Web address for ${tenant.name}`}
          placeholder="company-slug"
          autoCapitalize="none"
          onChange={(event) => setValue(event.target.value.toLowerCase())}
        />
        <span className="platform-company-address__suffix">.{TENANT_ROOT_DOMAIN}</span>
      </div>
      <button
        type="button"
        className={dirty ? "button" : "button secondary"}
        disabled={saving || !trimmed || !dirty}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : dirty ? "Save address" : "Saved"}
      </button>
    </div>
  );
}

export function CompaniesPage() {
  const { showToast } = useToast();
  const { tenants, healthByTenant, loading, statusMessage, error, hydrate, refresh, patchTenant } =
    usePlatformAdminStore(
      useShallow((s) => ({
        tenants: s.tenants,
        healthByTenant: s.healthByTenant,
        loading: s.loading,
        statusMessage: s.statusMessage,
        error: s.error,
        hydrate: s.hydrate,
        refresh: s.refresh,
        patchTenant: s.patchTenant
      }))
    );

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [registerOpen, setRegisterOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminDefaultTenantId, setAdminDefaultTenantId] = useState<string | undefined>();
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [editProfileTenant, setEditProfileTenant] = useState<TenantRecord | null>(null);
  const [editModulesOpen, setEditModulesOpen] = useState(false);
  const [editModulesTenant, setEditModulesTenant] = useState<TenantRecord | null>(null);
  const [editAddonsOpen, setEditAddonsOpen] = useState(false);
  const [editAddonsTenant, setEditAddonsTenant] = useState<TenantRecord | null>(null);
  const [customerSupportOpen, setCustomerSupportOpen] = useState(false);
  const [customerSupportTenant, setCustomerSupportTenant] = useState<TenantRecord | null>(null);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [terminateTenant, setTerminateTenant] = useState<TenantRecord | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (error) {
      showToast(error, "error");
    }
  }, [error, showToast]);

  async function toggleSubscription(tenant: TenantRecord) {
    const next = tenant.subscriptionStatus === "active" ? "inactive" : "active";
    try {
      await updateTenantSubscription(tenant.id, next);
      await refresh();
      showToast(`${tenant.name} subscription set to ${next}`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to update subscription", "error");
    }
  }

  function openCreateAdmin(tenantId?: string) {
    setAdminDefaultTenantId(tenantId);
    setAdminOpen(true);
  }

  const metrics = useMemo(() => {
    let activeCount = 0;
    let totalCustomers = 0;
    let totalStaff = 0;
    let totalPriorOpenTills = 0;
    let companiesWithOpenTills = 0;

    for (const t of tenants) {
      if (t.subscriptionStatus === "active") activeCount += 1;
      const h = healthByTenant[t.id];
      if (h) {
        totalCustomers += h.activeCustomers;
        totalStaff += h.activeUsers;
        totalPriorOpenTills += h.priorOpenTills;
        if (h.priorOpenTills > 0) companiesWithOpenTills += 1;
      }
    }

    return {
      total: tenants.length,
      activeCount,
      inactiveCount: tenants.length - activeCount,
      totalCustomers,
      totalStaff,
      totalPriorOpenTills,
      companiesWithOpenTills
    };
  }, [tenants, healthByTenant]);

  const filteredTenants = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tenants.filter((t) => {
      if (statusFilter === "active" && t.subscriptionStatus !== "active") return false;
      if (statusFilter === "inactive" && t.subscriptionStatus === "active") return false;
      if (statusFilter === "open_tills" && !(healthByTenant[t.id]?.priorOpenTills > 0)) return false;
      if (!q) return true;
      const host = isTenantSubdomain(t.subdomain || t.id)
        ? tenantSignInHost(t.subdomain || t.id)
        : "";
      const hay = `${t.name} ${t.id} ${t.subdomain ?? ""} ${host}`.toLowerCase();
      return hay.includes(q);
    });
  }, [tenants, healthByTenant, query, statusFilter]);

  return (
    <div className="platform-companies-page">
      <header className="overview-hero platform-companies-hero">
        <div>
          <p className="overview-hero__eyebrow">Platform administration</p>
          <h1 className="overview-hero__title">Companies</h1>
          <p className="overview-hero__sub muted">
            Manage tenant workspaces, branding profiles, custom subdomains, subscribed products,
            and live operational health.
          </p>
        </div>
        <div className="platform-companies-hero__actions">
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => openCreateAdmin()}
            disabled={tenants.length === 0}
          >
            + Create admin
          </button>
          <button type="button" className="button" onClick={() => setRegisterOpen(true)}>
            + Register company
          </button>
        </div>
      </header>

      <section className="statements-kpis">
        <article className="statements-kpi statements-kpi--primary">
          <span className="statements-kpi__label">Registered companies</span>
          <strong className="statements-kpi__value">{metrics.total}</strong>
          <span className="statements-kpi__sub">
            {metrics.activeCount} active · {metrics.inactiveCount} inactive
          </span>
        </article>
        <article className="statements-kpi statements-kpi--credit">
          <span className="statements-kpi__label">Active subscriptions</span>
          <strong className="statements-kpi__value">{metrics.activeCount}</strong>
          <span className="statements-kpi__sub">
            {metrics.total > 0 ? `${Math.round((metrics.activeCount / metrics.total) * 100)}%` : "0%"}{" "}
            of workspaces live
          </span>
        </article>
        <article className="statements-kpi">
          <span className="statements-kpi__label">Platform reach</span>
          <strong className="statements-kpi__value">
            {metrics.totalCustomers.toLocaleString()}
          </strong>
          <span className="statements-kpi__sub">
            active customers · {metrics.totalStaff.toLocaleString()} staff
          </span>
        </article>
        <article
          className={`statements-kpi${
            metrics.totalPriorOpenTills > 0 ? " statements-kpi--debit" : ""
          }`}
        >
          <span className="statements-kpi__label">Prior open tills</span>
          <strong className="statements-kpi__value">{metrics.totalPriorOpenTills}</strong>
          <span className="statements-kpi__sub">
            {metrics.companiesWithOpenTills > 0
              ? `across ${metrics.companiesWithOpenTills} compan${metrics.companiesWithOpenTills === 1 ? "y" : "ies"}`
              : "All tenant tills closed cleanly"}
          </span>
        </article>
      </section>

      <section className="overview-panel platform-companies-toolbar">
        <div className="statements-search-box platform-companies-search">
          <span className="statements-search-box__icon" aria-hidden>
            ⌕
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search company name, subdomain, or tenant ID…"
            aria-label="Search companies"
          />
          {query ? (
            <button
              type="button"
              className="statements-search-box__clear"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              ×
            </button>
          ) : null}
        </div>

        <div className="platform-companies-filters" role="group" aria-label="Filter companies">
          {(
            [
              { id: "all", label: `All (${metrics.total})` },
              { id: "active", label: `Active (${metrics.activeCount})` },
              { id: "inactive", label: `Inactive (${metrics.inactiveCount})` },
              ...(metrics.companiesWithOpenTills > 0
                ? [{ id: "open_tills" as const, label: `Open tills (${metrics.companiesWithOpenTills})` }]
                : [])
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              className={`statements-filter-pill${
                statusFilter === f.id ? " statements-filter-pill--active" : ""
              }`}
              onClick={() => setStatusFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      {loading && tenants.length === 0 ? (
        <section className="overview-panel platform-companies-empty">
          <p className="muted">{statusMessage || "Loading companies…"}</p>
        </section>
      ) : filteredTenants.length === 0 ? (
        <section className="overview-panel platform-companies-empty">
          <h3>No matching companies</h3>
          <p className="muted">
            {tenants.length === 0
              ? "Register your first tenant company to get started."
              : "Try clearing your search or status filter."}
          </p>
          {query || statusFilter !== "all" ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
              }}
            >
              Reset filters
            </button>
          ) : null}
        </section>
      ) : (
        <section className="platform-companies-grid" aria-label="Registered companies">
          {filteredTenants.map((tenant) => {
            const health = healthByTenant[tenant.id];
            const isActive = tenant.subscriptionStatus === "active";
            const host = isTenantSubdomain(tenant.subdomain || tenant.id)
              ? tenantSignInHost(tenant.subdomain || tenant.id)
              : null;

            return (
              <article
                className={`overview-panel platform-company-card${
                  !isActive ? " platform-company-card--inactive" : ""
                }`}
                key={tenant.id}
              >
                <div className="platform-company-card__head">
                  <div className="platform-company-card__identity">
                    <div className="platform-company-card__avatar" aria-hidden>
                      {companyInitials(tenant.name)}
                    </div>
                    <div className="platform-company-card__titles">
                      <div className="platform-company-card__name-row">
                        <h2 className="platform-company-card__name">{tenant.name}</h2>
                        <span
                          className={`statements-status-pill statements-status-pill--${
                            isActive ? "active" : "muted"
                          }`}
                        >
                          {tenant.subscriptionStatus}
                        </span>
                      </div>
                      <div className="platform-company-card__sub">
                        {host ? (
                          <a
                            href={`https://${host}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="platform-company-card__host"
                          >
                            {host} ↗
                          </a>
                        ) : (
                          <span className="statements-mono muted">{tenant.id}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="platform-company-card__actions">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        setEditProfileTenant(tenant);
                        setEditProfileOpen(true);
                      }}
                    >
                      Edit profile
                    </button>
                    <RowActionsMenu
                      ariaLabel={`More actions for ${tenant.name}`}
                      items={[
                        {
                          label: "Edit products",
                          onClick: () => {
                            setEditModulesTenant(tenant);
                            setEditModulesOpen(true);
                          }
                        },
                        {
                          label: "Edit add-ons",
                          onClick: () => {
                            setEditAddonsTenant(tenant);
                            setEditAddonsOpen(true);
                          }
                        },
                        {
                          label: "Add company admin",
                          onClick: () => openCreateAdmin(tenant.id)
                        },
                        {
                          label: "Customer support",
                          onClick: () => {
                            setCustomerSupportTenant(tenant);
                            setCustomerSupportOpen(true);
                          }
                        },
                        {
                          label: isActive ? "Set inactive" : "Set active",
                          onClick: () => void toggleSubscription(tenant)
                        },
                        {
                          label: "Terminate company",
                          danger: true,
                          onClick: () => {
                            setTerminateTenant(tenant);
                            setTerminateOpen(true);
                          }
                        }
                      ]}
                    />
                  </div>
                </div>

                {health ? (
                  <div className="platform-company-stats" aria-label="Operational health">
                    <div className="platform-company-stat">
                      <span>Staff</span>
                      <strong>{health.activeUsers}</strong>
                    </div>
                    <div className="platform-company-stat">
                      <span>Customers</span>
                      <strong>{health.activeCustomers}</strong>
                    </div>
                    <div
                      className={`platform-company-stat${
                        health.priorOpenTills > 0 ? " platform-company-stat--warn" : ""
                      }`}
                    >
                      <span>Prior open tills</span>
                      <strong>{health.priorOpenTills}</strong>
                    </div>
                    <div
                      className={`platform-company-stat${
                        health.smsEnabled ? " platform-company-stat--ok" : ""
                      }`}
                    >
                      <span>SMS</span>
                      <strong>
                        {health.smsEnabled ? health.smsSenderId || "ON" : "OFF"}
                      </strong>
                    </div>
                  </div>
                ) : null}

                <div className="platform-company-modules">
                  <span className="platform-company-section-label">Products &amp; add-ons</span>
                  <div className="module-pills">
                    {(tenant.subscribedModules ?? []).map((module) => (
                      <span className="module-pill" key={module}>
                        {MODULE_LABELS[module]}
                      </span>
                    ))}
                    {(tenant.subscribedAddons ?? []).map((addon) => (
                      <span className="module-pill module-pill--addon" key={addon}>
                        {ADDON_LABELS[addon]}
                      </span>
                    ))}
                    {isActive ? (
                      <>
                        <span className="module-pill module-pill--universal">
                          Reports &amp; Analytics
                        </span>
                        <span className="module-pill module-pill--universal">Settings</span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="platform-company-card__footer">
                  <div className="platform-company-footer-meta">
                    <span className="platform-company-section-label">Workspace URL</span>
                    {health?.lastActivityAt ? (
                      <span className="muted" style={{ fontSize: "0.75rem" }}>
                        Last active {new Date(health.lastActivityAt).toLocaleDateString()}
                      </span>
                    ) : null}
                  </div>
                  <CompanyAddressField tenant={tenant} onSaved={patchTenant} />
                </div>
              </article>
            );
          })}
        </section>
      )}

      <RegisterCompanyModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onCreated={(tenant) => {
          void refresh();
          setAdminDefaultTenantId(tenant.id);
        }}
      />

      <CreateAdminModal
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        tenants={tenants}
        defaultTenantId={adminDefaultTenantId}
        onCreated={() => void refresh()}
      />

      <EditTenantProfileModal
        open={editProfileOpen}
        tenant={editProfileTenant}
        onClose={() => {
          setEditProfileOpen(false);
          setEditProfileTenant(null);
        }}
        onUpdated={() => void refresh()}
      />

      <EditTenantModulesModal
        open={editModulesOpen}
        tenant={editModulesTenant}
        onClose={() => {
          setEditModulesOpen(false);
          setEditModulesTenant(null);
        }}
        onUpdated={() => void refresh()}
      />

      <EditTenantAddonsModal
        open={editAddonsOpen}
        tenant={editAddonsTenant}
        onClose={() => {
          setEditAddonsOpen(false);
          setEditAddonsTenant(null);
        }}
        onUpdated={() => void refresh()}
      />

      <TenantCustomerSupportModal
        open={customerSupportOpen}
        tenant={customerSupportTenant}
        onClose={() => {
          setCustomerSupportOpen(false);
          setCustomerSupportTenant(null);
        }}
      />

      <TerminateCompanyModal
        open={terminateOpen}
        tenant={terminateTenant}
        onClose={() => {
          setTerminateOpen(false);
          setTerminateTenant(null);
        }}
        onTerminated={() => void refresh()}
      />
    </div>
  );
}
