import { useEffect, useMemo, useState } from "react";
import type { Customer, FieldRoute } from "./api";
import { listRouteMembers, setRouteMembers } from "./api";
import { useCustomersStore } from "./stores/customersStore";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { formatBranchLabel } from "./branchDisplay";

type Props = {
  route: FieldRoute | null;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
};

function formatAccountTypeLabel(accountType?: Customer["accountType"]): string | null {
  switch (accountType) {
    case "susu":
      return "Susu";
    case "savings":
      return "Savings";
    case "group":
      return "Group";
    case "meba_daakye":
      return "Meba Daakye";
    default:
      return accountType ? String(accountType).replace(/_/g, " ") : null;
  }
}

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
    setQuery("");
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
    return candidates.filter((c) => {
      const typeLabel = formatAccountTypeLabel(c.accountType)?.toLowerCase() ?? "";
      return (
        c.fullName.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.accountNumber?.toLowerCase().includes(q) ?? false) ||
        (c.location?.toLowerCase().includes(q) ?? false) ||
        typeLabel.includes(q)
      );
    });
  }, [candidates, query]);

  const memberSet = useMemo(() => new Set(members), [members]);

  function toggleMember(customerId: string) {
    setMembers((prev) =>
      prev.includes(customerId) ? prev.filter((id) => id !== customerId) : [...prev, customerId]
    );
  }

  function selectAllVisible() {
    setMembers((prev) => [...new Set([...prev, ...filtered.map((c) => c.id)])]);
  }

  function clearVisible() {
    const visibleIds = new Set(filtered.map((c) => c.id));
    setMembers((prev) => prev.filter((id) => !visibleIds.has(id)));
  }

  async function handleSave() {
    if (!route) {
      return;
    }
    setSaving(true);
    try {
      await setRouteMembers(route.id, members);
      showToast(`${members.length} member(s) on route`, "success");
      void useCustomersStore.getState().refreshSilent();
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
      subtitle={`${route.area} · ${formatBranchLabel(route.branchId, [], route.branchName, route.branchCode)}`}
      onClose={onClose}
      panelClassName="modal-panel--70 route-modal"
      footer={
        <>
          <button type="button" className="route-btn route-btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="route-btn route-btn--primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? "Saving…" : `Save members (${members.length})`}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="routes-empty-state">
          <p className="muted">Loading eligible branch customers…</p>
        </div>
      ) : (
        <div className="route-members-wrap">
          <div className="route-members-toolbar">
            <label className="route-field" style={{ flex: "1 1 240px" }}>
              <span className="route-field__label">Search eligible customers</span>
              <div className="route-search-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="search"
                  className="route-input route-input--search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, phone, account #, location…"
                />
              </div>
            </label>

            <div className="route-members-toolbar__actions">
              <span className="route-badge route-badge--primary">
                {members.length} of {candidates.length} selected
              </span>
              <button
                type="button"
                className="route-btn route-btn--secondary route-btn--sm"
                onClick={selectAllVisible}
                disabled={filtered.length === 0}
              >
                Select visible
              </button>
              <button
                type="button"
                className="route-btn route-btn--ghost route-btn--sm"
                onClick={clearVisible}
                disabled={members.length === 0}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="route-members-list">
            {filtered.length === 0 ? (
              <div className="routes-empty-state">
                <p className="muted">No eligible unassigned customers match your search.</p>
              </div>
            ) : (
              filtered.map((c) => {
                const accountTypeLabel = formatAccountTypeLabel(c.accountType);
                const checked = memberSet.has(c.id);
                return (
                  <label
                    key={c.id}
                    className={`route-members-row${checked ? " is-checked" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="route-checkbox"
                      checked={checked}
                      onChange={() => toggleMember(c.id)}
                    />
                    <span className="route-members-row__body">
                      <span className="route-members-row__head">
                        <strong>{c.fullName}</strong>
                        {accountTypeLabel ? (
                          <span
                            className={`route-badge route-badge--${
                              c.accountType === "savings" ? "warning" : "primary"
                            }`}
                          >
                            {accountTypeLabel}
                          </span>
                        ) : null}
                      </span>
                      <span className="route-cell-meta">
                        <span>{c.accountNumber ?? "No account #"}</span>
                        <span>·</span>
                        <span>{c.phone}</span>
                        {c.location ? (
                          <>
                            <span>·</span>
                            <span>{c.location}</span>
                          </>
                        ) : null}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
