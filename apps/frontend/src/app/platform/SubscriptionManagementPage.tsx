import { useEffect, useState } from "react";
import type { TenantRecord } from "../api";
import { listPlatformTenants } from "../api";

export function SubscriptionManagementPage() {
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [status, setStatus] = useState("Loading subscriptions...");

  useEffect(() => {
    void listPlatformTenants()
      .then((data) => {
        setTenants(data);
        setStatus("");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Failed to load"));
  }, []);

  const active = tenants.filter((t) => t.subscriptionStatus === "active").length;

  return (
    <>
      <section className="kpi-grid">
        <article className="kpi-card kpi-card--primary">
          <p className="kpi-label">Total Companies</p>
          <p className="kpi-value">{tenants.length}</p>
        </article>
        <article className="kpi-card kpi-card--success">
          <p className="kpi-label">Active</p>
          <p className="kpi-value">{active}</p>
        </article>
        <article className="kpi-card kpi-card--warning">
          <p className="kpi-label">Inactive</p>
          <p className="kpi-value">{tenants.length - active}</p>
        </article>
      </section>

      <article className="card">
        <h2>Subscription Management</h2>
        <p className="muted">Platform-wide view of company subscription status, products, and add-ons.</p>
        <p className="muted">{status}</p>
        <div className="lines">
          {tenants.map((tenant) => (
            <div className="line tenant-line" key={tenant.id}>
              <div>
                <strong>{tenant.name}</strong>
                <small>
                  {tenant.id} · {tenant.subscriptionStatus}
                </small>
                <p className="muted">
                  Products: {(tenant.subscribedModules ?? []).join(", ") || "none"}
                  {(tenant.subscribedAddons ?? []).length > 0
                    ? ` · Add-ons: ${tenant.subscribedAddons!.join(", ")}`
                    : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      </article>
    </>
  );
}
