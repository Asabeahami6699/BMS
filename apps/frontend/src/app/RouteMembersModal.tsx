import { useEffect, useMemo, useState } from "react";
import type { Customer, FieldRoute } from "./api";
import { listRouteMembers, setRouteMembers } from "./api";
import { useCustomersStore } from "./stores/customersStore";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";

type Props = {
  route: FieldRoute | null;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
};

export function RouteMembersModal({ route, open, onClose, onUpdated }: Props) {
  const { showToast } = useToast();
  const allCustomers = useCustomersStore((s) => s.customers);
  const customersLoading = useCustomersStore((s) => s.loading);
  const [members, setMembers] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [saving, setSaving] = useState(false);

  const candidates = useMemo(() => {
    if (!route) {
      return [];
    }
    return allCustomers.filter(
      (c) =>
        c.status === "active" &&
        c.homeBranchId === route.branchId &&
        (!c.routeId || c.routeId === route.id)
    );
  }, [allCustomers, route]);

  useEffect(() => {
    if (!open || !route) {
      return;
    }
    useCustomersStore.getState().hydrate();
    setLoadingMembers(true);
    void listRouteMembers(route.id)
      .then((memberRows) => setMembers(memberRows.map((m) => m.id)))
      .catch((error) => {
        showToast(error instanceof Error ? error.message : "Failed to load members", "error");
      })
      .finally(() => setLoadingMembers(false));
  }, [open, route, showToast]);

  const loading = loadingMembers || (customersLoading && allCustomers.length === 0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return candidates;
    }
    return candidates.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.accountNumber?.toLowerCase().includes(q) ?? false)
    );
  }, [candidates, query]);

  function toggleMember(customerId: string) {
    setMembers((prev) =>
      prev.includes(customerId) ? prev.filter((id) => id !== customerId) : [...prev, customerId]
    );
  }

  async function handleSave() {
    if (!route) {
      return;
    }
    setSaving(true);
    try {
      await setRouteMembers(route.id, members);
      showToast(`${members.length} member(s) on route`, "success");
      onUpdated();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save members", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!route) {
    return null;
  }

  return (
    <Modal
      open={open}
      title={`Members — ${route.name}`}
      subtitle={`${route.area} · ${route.branchName ?? route.branchId}`}
      onClose={onClose}
      panelClassName="modal-panel--70"
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : `Save (${members.length} members)`}
          </button>
        </>
      }
    >
      {loading ? (
        <p className="muted">Loading customers…</p>
      ) : (
        <>
          <p className="muted">
            Active customers at this branch who are not on another route. Assigning syncs the route
            agent when one is set.
          </p>
          <label className="field">
            <span>Search</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, phone, account #"
            />
          </label>
          <div className="route-members-list">
            {filtered.length === 0 ? (
              <p className="muted">No eligible customers.</p>
            ) : (
              filtered.map((c) => (
                <label key={c.id} className="route-members-row">
                  <input
                    type="checkbox"
                    checked={members.includes(c.id)}
                    onChange={() => toggleMember(c.id)}
                  />
                  <span>
                    <strong>{c.fullName}</strong>
                    <small className="muted">
                      {c.accountNumber ?? "No account #"} · {c.phone}
                    </small>
                  </span>
                </label>
              ))
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
