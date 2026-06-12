import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppRole, Customer } from "./api";
import { RegistrationModal } from "../agent/RegistrationModal";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { useToast } from "../components/Toast";
import { formatFieldAgent } from "../lib/formatFieldAgent";
import { formatNextOfKin } from "../lib/formatNextOfKin";
import { PendingApprovalsCard } from "./PendingApprovalsCard";
import { RegistrationReviewModal } from "./RegistrationReviewModal";
import { useCoordinatorLiveSync } from "./hooks/useCoordinatorLiveSync";
import { useCustomersLiveSync } from "./hooks/useCustomersLiveSync";
import { useCoordinatorStore } from "./stores/coordinatorStore";
import { useCustomersStore } from "./stores/customersStore";

type Props = { role: AppRole };

const ONBOARDING_WORKFLOW = [
  "Field Agent → Customer Registration",
  "Pending Approval",
  "Coordinator Review",
  "Active Customer"
];

const STATUS_LABEL: Record<Customer["status"], string> = {
  pending_activation: "Pending",
  active: "Active",
  rejected: "Rejected",
  suspended: "Suspended",
  closed: "Closed"
};

export function CustomerOnboardingPage({ role }: Props) {
  useCoordinatorLiveSync();
  useCustomersLiveSync();
  const { showToast } = useToast();

  const canRegister = role === "admin" || role === "coordinator" || role === "field_agent";
  const canReview = role === "admin" || role === "coordinator";

  const pending = useCoordinatorStore((s) => s.pendingRegistrations);
  const branches = useCoordinatorStore((s) => s.branches);
  const customers = useCustomersStore((s) => s.customers);
  const customersLoading = useCustomersStore((s) => s.loading);

  const [createOpen, setCreateOpen] = useState(false);
  const [reviewCustomer, setReviewCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState("");

  const recentPending = useMemo(() => [...pending], [pending]);

  const recentlyActivated = useMemo(
    () => customers.filter((c) => c.status === "active").slice(0, 12),
    [customers]
  );

  const filteredRecent = useMemo(
    () =>
      filterRowsBySearch(recentlyActivated, search, [
        "fullName",
        "phone",
        "accountNumber",
        "location"
      ] as (keyof Customer)[]),
    [recentlyActivated, search]
  );

  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);

  function branchLabel(customer: Customer): string | undefined {
    const branch = branchById.get(customer.homeBranchId);
    return branch ? `${branch.name} (${branch.code})` : undefined;
  }

  return (
    <div className="agents-page">
      <header className="agents-page__header">
        <div>
          <h2>Customer Onboarding</h2>
          <p className="muted">
            Register customers with full KYC. Field agents submit registrations; coordinators review
            and activate accounts. Deposits and withdrawals post only after coordinator approval via
            callover batches and pending approvals.
          </p>
        </div>
        <div className="agents-page__header-actions">
          {canReview ? (
            <Link to="/app/susu/pending-approvals" className="button secondary">
              Pending approvals
            </Link>
          ) : null}
          {canRegister ? (
            <button type="button" className="button" onClick={() => setCreateOpen(true)}>
              Register customer
            </button>
          ) : null}
        </div>
      </header>

      <div className="kpi-grid agents-page__kpis">
        <article className="kpi-card kpi-card--warning">
          <span className="kpi-label">Pending approval</span>
          <p className="kpi-value">{pending.length}</p>
        </article>
        <article className="kpi-card kpi-card--success">
          <span className="kpi-label">Active customers</span>
          <p className="kpi-value">{customers.filter((c) => c.status === "active").length}</p>
        </article>
        <article className="kpi-card kpi-card--primary">
          <span className="kpi-label">Workflow stage</span>
          <p className="kpi-value" style={{ fontSize: "1rem" }}>
            {canReview ? "Coordinator review" : "Registration"}
          </p>
        </article>
      </div>

      <section className="card onboarding-workflow-card">
        <h3>Workflow</h3>
        <ol className="onboarding-workflow-steps">
          {ONBOARDING_WORKFLOW.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="muted onboarding-workflow-note">
          Registration captures personal info, Ghana Card, address, account type, opening balance, and
          assigned field agent. New accounts start as <strong>Pending Approval</strong> until a
          coordinator assigns an account number and activates the customer.
        </p>
      </section>

      {canReview ? <PendingApprovalsCard /> : null}

      {!canReview && recentPending.length > 0 ? (
        <section className="card">
          <h3>Your pending registrations</h3>
          <div className="lines">
            {recentPending.map((c) => (
              <div className="line tenant-line" key={c.id}>
                <div>
                  <strong>{c.fullName}</strong>
                  <small>
                    {c.phone} · {c.accountType?.replace(/_/g, " ") ?? "—"} · Pending approval
                  </small>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card agents-page__table-card">
        <AdminDataTable
          columns={[
            {
              key: "customer",
              label: "Customer",
              render: (row) => (
                <div>
                  <strong>{row.fullName}</strong>
                  <small className="muted" style={{ display: "block" }}>
                    {row.phone}
                    {row.accountNumber ? ` · ${row.accountNumber}` : ""}
                  </small>
                </div>
              )
            },
            {
              key: "type",
              label: "Account",
              render: (row) => row.accountType?.replace(/_/g, " ") ?? "—"
            },
            {
              key: "agent",
              label: "Field agent",
              render: (row) => formatFieldAgent(row)
            },
            {
              key: "branch",
              label: "Branch",
              render: (row) => branchLabel(row) ?? "—"
            },
            {
              key: "status",
              label: "Status",
              render: (row) => STATUS_LABEL[row.status]
            }
          ]}
          rows={filteredRecent}
          rowKey={(row) => row.id}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search recently activated customers…"
          emptyMessage={
            customersLoading ? "Loading customers…" : "No recently activated customers yet."
          }
          toolbar={
            <Link to="/app/susu/customers" className="button secondary">
              All customers
            </Link>
          }
          actions={
            canReview
              ? (row) => (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setReviewCustomer(row)}
                  >
                    View
                  </button>
                )
              : undefined
          }
        />
      </section>

      <RegistrationModal
        open={createOpen}
        variant="office"
        branches={branches}
        onClose={() => setCreateOpen(false)}
        onSubmitted={() => {
          setCreateOpen(false);
          showToast("Registration submitted — pending coordinator approval", "success");
          void useCoordinatorStore.getState().refreshSilent();
          void useCustomersStore.getState().refreshSilent();
        }}
      />

      <RegistrationReviewModal
        open={reviewCustomer !== null}
        customer={reviewCustomer}
        agentLabel={reviewCustomer ? formatFieldAgent(reviewCustomer) : undefined}
        branchLabel={reviewCustomer ? branchLabel(reviewCustomer) : undefined}
        onClose={() => setReviewCustomer(null)}
        onDecided={() => {
          if (reviewCustomer) {
            useCoordinatorStore.getState().removePendingRegistration(reviewCustomer.id);
          }
          void useCoordinatorStore.getState().refreshSilent();
          void useCustomersStore.getState().refreshSilent();
        }}
      />
    </div>
  );
}
