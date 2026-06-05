import { useEffect, useState } from "react";
import { ADDON_LABELS, MODULE_LABELS } from "@bms/shared";
import type { TenantRecord } from "../api";
import { listPlatformTenants, updateTenantSubscription } from "../api";
import { useToast } from "../../components/Toast";
import { CreateAdminModal } from "./CreateAdminModal";
import { EditTenantAddonsModal } from "./EditTenantAddonsModal";
import { EditTenantModulesModal } from "./EditTenantModulesModal";
import { RegisterCompanyModal } from "./RegisterCompanyModal";

export function CompaniesPage() {
  const { showToast } = useToast();
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [status, setStatus] = useState("Loading companies...");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminDefaultTenantId, setAdminDefaultTenantId] = useState<string | undefined>();
  const [editModulesOpen, setEditModulesOpen] = useState(false);
  const [editModulesTenant, setEditModulesTenant] = useState<TenantRecord | null>(null);
  const [editAddonsOpen, setEditAddonsOpen] = useState(false);
  const [editAddonsTenant, setEditAddonsTenant] = useState<TenantRecord | null>(null);

  async function loadTenants() {
    try {
      const data = await listPlatformTenants();
      setTenants(data);
      setStatus(data.length === 0 ? "No companies registered yet." : "");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load companies");
      showToast("Failed to load companies", "error");
    }
  }

  useEffect(() => {
    void loadTenants();
  }, []);

  async function toggleSubscription(tenant: TenantRecord) {
    const next = tenant.subscriptionStatus === "active" ? "inactive" : "active";
    try {
      await updateTenantSubscription(tenant.id, next);
      await loadTenants();
      showToast(`${tenant.name} subscription set to ${next}`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to update subscription", "error");
    }
  }

  function openCreateAdmin(tenantId?: string) {
    setAdminDefaultTenantId(tenantId);
    setAdminOpen(true);
  }

  const activeCount = tenants.filter((t) => t.subscriptionStatus === "active").length;

  return (
    <>
      <section className="kpi-grid">
        <article className="kpi-card kpi-card--primary">
          <div className="kpi-card-head">
            <div>
              <p className="kpi-label">Registered Companies</p>
              <p className="kpi-value">{tenants.length}</p>
            </div>
            <span className="kpi-icon" aria-hidden>
              🏢
            </span>
          </div>
        </article>
        <article className="kpi-card kpi-card--success">
          <div className="kpi-card-head">
            <div>
              <p className="kpi-label">Active Subscriptions</p>
              <p className="kpi-value">{activeCount}</p>
            </div>
            <span className="kpi-icon" aria-hidden>
              ✓
            </span>
          </div>
        </article>
        <article className="kpi-card kpi-card--warning">
          <div className="kpi-card-head">
            <div>
              <p className="kpi-label">Inactive</p>
              <p className="kpi-value">{tenants.length - activeCount}</p>
            </div>
            <span className="kpi-icon" aria-hidden>
              ⏸
            </span>
          </div>
        </article>
      </section>

      <article className="card platform-actions-card">
        <div className="platform-actions-head">
          <div>
            <h2>Company management</h2>
            <p className="muted">Register tenants and create company admin login accounts.</p>
          </div>
          <div className="platform-actions-buttons">
            <button type="button" className="button" onClick={() => setRegisterOpen(true)}>
              + Register company
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => openCreateAdmin()}
              disabled={tenants.length === 0}
            >
              + Create company admin
            </button>
          </div>
        </div>
      </article>

      <article className="card">
        <h2>Registered Companies</h2>
        <p className="muted">{status}</p>
        <div className="lines">
          {tenants.map((tenant) => (
            <div className="line tenant-line" key={tenant.id}>
              <div>
                <strong>{tenant.name}</strong>
                <small>
                  {tenant.id} ·{" "}
                  <span
                    className={`status-pill status-pill--${tenant.subscriptionStatus === "active" ? "active" : "inactive"}`}
                  >
                    {tenant.subscriptionStatus}
                  </span>
                </small>
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
                  {tenant.subscriptionStatus === "active" && (
                    <>
                      <span className="module-pill module-pill--universal">Reports &amp; Analytics</span>
                      <span className="module-pill module-pill--universal">Settings</span>
                    </>
                  )}
                </div>
              </div>
              <div className="tenant-line-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setEditModulesTenant(tenant);
                    setEditModulesOpen(true);
                  }}
                >
                  Edit products
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setEditAddonsTenant(tenant);
                    setEditAddonsOpen(true);
                  }}
                >
                  Edit add-ons
                </button>
                <button type="button" className="button secondary" onClick={() => openCreateAdmin(tenant.id)}>
                  Add admin
                </button>
                <button type="button" className="button secondary" onClick={() => toggleSubscription(tenant)}>
                  Set {tenant.subscriptionStatus === "active" ? "inactive" : "active"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </article>

      <RegisterCompanyModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onCreated={(tenant) => {
          void loadTenants();
          setAdminDefaultTenantId(tenant.id);
        }}
      />

      <CreateAdminModal
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        tenants={tenants}
        defaultTenantId={adminDefaultTenantId}
        onCreated={() => void loadTenants()}
      />

      <EditTenantModulesModal
        open={editModulesOpen}
        tenant={editModulesTenant}
        onClose={() => {
          setEditModulesOpen(false);
          setEditModulesTenant(null);
        }}
        onUpdated={() => void loadTenants()}
      />

      <EditTenantAddonsModal
        open={editAddonsOpen}
        tenant={editAddonsTenant}
        onClose={() => {
          setEditAddonsOpen(false);
          setEditAddonsTenant(null);
        }}
        onUpdated={() => void loadTenants()}
      />
    </>
  );
}
