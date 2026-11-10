import { useEffect, useMemo, useState } from "react";
import type { Customer, TenantRecord } from "../api";
import {
  listPlatformTenantCustomers,
  platformDeleteAllCustomers,
  platformDeleteCustomer,
  platformResetAllCustomers,
  platformResetCustomerAccount
} from "../api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { toUserFacingError } from "../../lib/networkError";

type Props = {
  open: boolean;
  tenant: TenantRecord | null;
  onClose: () => void;
};

export function TenantCustomerSupportModal({ open, tenant, onClose }: Props) {
  const { showToast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<"reset" | "delete" | null>(null);

  async function load(q?: string) {
    if (!tenant) {
      return;
    }
    setLoading(true);
    try {
      setCustomers(await listPlatformTenantCustomers(tenant.id, q));
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to load customers"), "error");
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !tenant) {
      return;
    }
    setSearch("");
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/tenant only
  }, [open, tenant?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return customers;
    }
    return customers.filter((c) =>
      [c.fullName, c.phone, c.accountNumber, c.status]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [customers, search]);

  const actionLocked = busyId != null || bulkBusy != null;

  async function handleReset(customer: Customer) {
    if (!tenant) {
      return;
    }
    const ok = await confirm({
      title: "Clear ledger / reset account",
      message: `Clear all ledger entries and balances for ${customer.fullName} (${customer.accountNumber ?? customer.id}) in ${tenant.name}? The customer profile is kept.`,
      confirmLabel: "Clear ledger",
      danger: true
    });
    if (!ok) {
      return;
    }
    setBusyId(customer.id);
    try {
      await platformResetCustomerAccount(tenant.id, customer.id);
      showToast("Ledger cleared — account reset", "success");
      await load(search);
    } catch (error) {
      showToast(toUserFacingError(error, "Could not reset account"), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(customer: Customer) {
    if (!tenant) {
      return;
    }
    const ok = await confirm({
      title: "Delete customer permanently",
      message: `Permanently delete ${customer.fullName} and all related transactions from ${tenant.name}? This cannot be undone.`,
      confirmLabel: "Delete customer",
      danger: true
    });
    if (!ok) {
      return;
    }
    setBusyId(customer.id);
    try {
      await platformDeleteCustomer(tenant.id, customer.id);
      showToast("Customer deleted", "success");
      await load(search);
    } catch (error) {
      showToast(toUserFacingError(error, "Could not delete customer"), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleResetAll() {
    if (!tenant || customers.length === 0) {
      return;
    }
    const ok = await confirm({
      title: "Reset all customer ledgers",
      message: `Clear ledger history and balances for all ${customers.length} customers in ${tenant.name}? Profiles are kept. This cannot be undone.`,
      confirmLabel: "Reset all",
      danger: true
    });
    if (!ok) {
      return;
    }
    setBulkBusy("reset");
    try {
      const result = await platformResetAllCustomers(tenant.id);
      showToast(
        result.errors.length > 0
          ? `Reset ${result.reset}/${result.total} — ${result.errors.length} failed`
          : `Reset ${result.reset} customer ledger${result.reset === 1 ? "" : "s"}`,
        result.errors.length > 0 ? "error" : "success"
      );
      await load(search);
    } catch (error) {
      showToast(toUserFacingError(error, "Could not reset all customers"), "error");
    } finally {
      setBulkBusy(null);
    }
  }

  async function handleDeleteAll() {
    if (!tenant || customers.length === 0) {
      return;
    }
    const ok = await confirm({
      title: "Delete all customers",
      message: `Permanently delete all ${customers.length} customers and their transactions in ${tenant.name}? This cannot be undone.`,
      confirmLabel: "Delete all",
      danger: true
    });
    if (!ok) {
      return;
    }
    setBulkBusy("delete");
    try {
      const result = await platformDeleteAllCustomers(tenant.id);
      showToast(
        result.errors.length > 0
          ? `Deleted ${result.deleted}/${result.total} — ${result.errors.length} failed`
          : `Deleted ${result.deleted} customer${result.deleted === 1 ? "" : "s"}`,
        result.errors.length > 0 ? "error" : "success"
      );
      await load(search);
    } catch (error) {
      showToast(toUserFacingError(error, "Could not delete all customers"), "error");
    } finally {
      setBulkBusy(null);
    }
  }

  return (
    <>
      <Modal
        open={open && tenant != null}
        title={tenant ? `Customer support — ${tenant.name}` : "Customer support"}
        subtitle="Super admin only: clear ledgers or permanently delete tenant customers."
        onClose={onClose}
        panelClassName="modal-panel--70"
      >
        <div className="platform-customer-support">
          <label className="field">
            <span>Search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone, account…"
            />
          </label>
          <div className="platform-customer-support__toolbar">
            <p className="muted">
              {loading
                ? "Loading…"
                : `${filtered.length} customer${filtered.length === 1 ? "" : "s"}`}
            </p>
            <div className="platform-customer-support__toolbar-actions">
              <button
                type="button"
                className="button secondary"
                disabled={loading || actionLocked || customers.length === 0}
                onClick={() => void handleResetAll()}
              >
                {bulkBusy === "reset" ? "Resetting all…" : "Reset all"}
              </button>
              <button
                type="button"
                className="button button--danger"
                disabled={loading || actionLocked || customers.length === 0}
                onClick={() => void handleDeleteAll()}
              >
                {bulkBusy === "delete" ? "Deleting all…" : "Delete all"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={loading || actionLocked || !tenant}
                onClick={() => void load(search)}
              >
                Refresh
              </button>
            </div>
          </div>
          {filtered.length === 0 && !loading ? (
            <p className="muted">No customers found for this company.</p>
          ) : (
            <ul className="platform-customer-support__list">
              {filtered.map((customer) => (
                <li key={customer.id} className="platform-customer-support__row">
                  <div>
                    <strong>{customer.fullName}</strong>
                    <small>
                      {customer.accountNumber ?? "No account #"} · {customer.phone} ·{" "}
                      {customer.status.replace(/_/g, " ")}
                    </small>
                  </div>
                  <div className="platform-customer-support__actions">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={actionLocked}
                      onClick={() => void handleReset(customer)}
                    >
                      {busyId === customer.id ? "Working…" : "Clear ledger"}
                    </button>
                    <button
                      type="button"
                      className="button button--danger"
                      disabled={actionLocked}
                      onClick={() => void handleDelete(customer)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
      <ConfirmDialog {...dialogProps} />
    </>
  );
}
