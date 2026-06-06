import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { LoanGroup, LoanGroupMemberRole } from "@bms/shared";
import type { AppRole } from "./api";
import {
  addLoanGroupMember,
  createLoanGroup,
  getLoanGroup,
  removeLoanGroupMember,
  updateLoanGroup
} from "./api";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { useCustomersLiveSync } from "./hooks/useCustomersLiveSync";
import { useCustomersStore } from "./stores/customersStore";
import { useLoansStore } from "./stores/loansStore";
import { useLoanPermissions } from "./hooks/useLoanPermissions";
import { LoansLayout } from "./loans/LoansLayout";
import { customerDisplayName } from "./loans/loanUi";

type Props = { role: AppRole };

const ROLES: { value: LoanGroupMemberRole; label: string }[] = [
  { value: "chair", label: "Chair" },
  { value: "secretary", label: "Secretary" },
  { value: "treasurer", label: "Treasurer" },
  { value: "member", label: "Member" }
];

const MEETING_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type GroupForm = {
  name: string;
  branchId: string;
  description: string;
  meetingDay: string;
  minMembers: string;
  maxMembers: string;
};

const emptyForm = (): GroupForm => ({
  name: "",
  branchId: "",
  description: "",
  meetingDay: "",
  minMembers: "5",
  maxMembers: "15"
});

export function LoanGroupsPage({ role: _role }: Props) {
  const { showToast } = useToast();
  useCustomersLiveSync();
  const { canCreateApplication } = useLoanPermissions();
  const loading = useLoansStore((s) => s.loading);
  const error = useLoansStore((s) => s.error);
  const groups = useLoansStore((s) => s.groups);
  const refresh = useLoansStore((s) => s.refresh);
  const upsertGroup = useLoansStore((s) => s.upsertGroup);
  const customers = useCustomersStore((s) => s.customers);
  const branches = useCustomersStore((s) => s.branches);

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<GroupForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LoanGroup | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [memberCustomerId, setMemberCustomerId] = useState("");
  const [memberRole, setMemberRole] = useState<LoanGroupMemberRole>("member");
  const [memberBusy, setMemberBusy] = useState(false);

  const filtered = useMemo(
    () => filterRowsBySearch(groups, search, ["name", "branchName", "meetingDay"] as (keyof LoanGroup)[]),
    [groups, search]
  );

  const activeCustomers = useMemo(
    () => customers.filter((c) => c.status === "active"),
    [customers]
  );

  const activeBranches = useMemo(
    () => branches.filter((b) => b.status !== "inactive"),
    [branches]
  );

  const memberIds = useMemo(
    () => new Set((detail?.members ?? []).filter((m) => m.status === "active").map((m) => m.customerId)),
    [detail?.members]
  );

  const addableCustomers = useMemo(
    () => activeCustomers.filter((c) => !memberIds.has(c.id)),
    [activeCustomers, memberIds]
  );

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    void getLoanGroup(selectedId)
      .then(setDetail)
      .catch((err) => showToast(toUserFacingError(err, "Failed to load group"), "error"))
      .finally(() => setDetailLoading(false));
  }, [selectedId, showToast]);

  async function reloadDetail(groupId: string) {
    const group = await getLoanGroup(groupId);
    setDetail(group);
    upsertGroup(group);
  }

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    const minMembers = Number(form.minMembers);
    const maxMembers = Number(form.maxMembers);
    if (!form.name.trim() || !form.branchId) {
      showToast("Name and branch are required", "error");
      return;
    }
    if (!Number.isFinite(minMembers) || !Number.isFinite(maxMembers) || minMembers < 2 || maxMembers < minMembers) {
      showToast("Enter valid member limits (min 2, max ≥ min)", "error");
      return;
    }
    setBusy(true);
    try {
      const created = await createLoanGroup({
        name: form.name.trim(),
        branchId: form.branchId,
        description: form.description.trim() || undefined,
        meetingDay: form.meetingDay || undefined,
        minMembers,
        maxMembers
      });
      upsertGroup(created);
      setShowForm(false);
      setForm(emptyForm());
      setSelectedId(created.id);
      showToast("Group created", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to create group"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !memberCustomerId) {
      showToast("Select a customer to add", "error");
      return;
    }
    setMemberBusy(true);
    try {
      await addLoanGroupMember(selectedId, { customerId: memberCustomerId, role: memberRole });
      await reloadDetail(selectedId);
      setMemberCustomerId("");
      setMemberRole("member");
      showToast("Member added", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to add member"), "error");
    } finally {
      setMemberBusy(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!selectedId) {
      return;
    }
    setMemberBusy(true);
    try {
      await removeLoanGroupMember(selectedId, memberId);
      await reloadDetail(selectedId);
      showToast("Member removed", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to remove member"), "error");
    } finally {
      setMemberBusy(false);
    }
  }

  async function toggleGroupStatus(group: LoanGroup) {
    if (!canCreateApplication) {
      return;
    }
    setBusy(true);
    try {
      const updated = await updateLoanGroup(group.id, {
        status: group.status === "active" ? "inactive" : "active"
      });
      upsertGroup(updated);
      if (selectedId === group.id) {
        await reloadDetail(group.id);
      }
      showToast(updated.status === "active" ? "Group activated" : "Group deactivated", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Update failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <LoansLayout
      activeNav="groups"
      title="Solidarity groups"
      subtitle="Register lending groups of individual customers for group solidarity loans."
      actions={
        <>
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => {
              void refresh().catch((err) =>
                showToast(toUserFacingError(err, "Failed to refresh groups"), "error")
              );
            }}
          >
            {loading ? "…" : "↻"}
          </button>
          {canCreateApplication ? (
            <>
              <Link to="/app/loans/apply/group" className="button secondary">
                Group application
              </Link>
              <button type="button" className="button primary" onClick={() => setShowForm(true)}>
                New group
              </button>
            </>
          ) : null}
        </>
      }
    >
      {error ? <p className="loans-field-error loans-animate-in">{error}</p> : null}

      {showForm && canCreateApplication ? (
        <section className="card loans-form-panel loans-animate-in">
          <h3>New solidarity group</h3>
          <form className="loans-form-grid" onSubmit={(e) => void handleCreateGroup(e)}>
            <label className="field">
              <span>Group name</span>
              <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="field">
              <span>Branch</span>
              <select
                required
                value={form.branchId}
                onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
              >
                <option value="">Select branch</option>
                {activeBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Meeting day</span>
              <select value={form.meetingDay} onChange={(e) => setForm((f) => ({ ...f, meetingDay: e.target.value }))}>
                <option value="">Optional</option>
                {MEETING_DAYS.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Minimum members</span>
              <input
                required
                type="text"
                inputMode="numeric"
                value={form.minMembers}
                onChange={(e) => setForm((f) => ({ ...f, minMembers: e.target.value.replace(/\D/g, "") }))}
              />
            </label>
            <label className="field">
              <span>Maximum members</span>
              <input
                required
                type="text"
                inputMode="numeric"
                value={form.maxMembers}
                onChange={(e) => setForm((f) => ({ ...f, maxMembers: e.target.value.replace(/\D/g, "") }))}
              />
            </label>
            <label className="field field--full">
              <span>Description</span>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </label>
            <div className="loans-wizard-actions field--full">
              <button type="button" className="button secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={busy}>
                {busy ? "Creating…" : "Create group"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="card loans-animate-in loans-animate-in--2">
        <AdminDataTable
          columns={[
            { key: "name", label: "Group", render: (row) => <strong>{row.name}</strong> },
            { key: "branch", label: "Branch", render: (row) => row.branchName ?? "—" },
            {
              key: "members",
              label: "Members",
              render: (row) =>
                `${row.activeMemberCount ?? 0} active · min ${row.minMembers}`
            },
            { key: "meeting", label: "Meeting", render: (row) => row.meetingDay ?? "—" },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <span className={`status-pill status-pill--${row.status === "active" ? "active" : "inactive"}`}>
                  {row.status}
                </span>
              )
            }
          ]}
          rows={filtered}
          rowKey={(row) => row.id}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search groups…"
          emptyMessage={loading && !groups.length ? "Loading groups…" : "No solidarity groups yet."}
          actions={(row) => (
            <>
              <button
                type="button"
                className={`button link${selectedId === row.id ? " loans-subnav__link--active" : ""}`}
                onClick={() => setSelectedId(row.id)}
              >
                Manage
              </button>
              {canCreateApplication ? (
                <button type="button" className="button link" disabled={busy} onClick={() => void toggleGroupStatus(row)}>
                  {row.status === "active" ? "Deactivate" : "Activate"}
                </button>
              ) : null}
            </>
          )}
        />
      </section>

      {selectedId ? (
        <section className="card loans-animate-in loans-animate-in--3">
          <h3>{detail?.name ?? "Group members"}</h3>
          {detailLoading ? (
            <p>Loading members…</p>
          ) : detail ? (
            <>
              <p className="loans-hero__subtitle">
                {detail.activeMemberCount ?? 0} active members · minimum {detail.minMembers} required for loans
              </p>

              {canCreateApplication ? (
                <form className="loans-form-grid loans-animate-in" onSubmit={(e) => void handleAddMember(e)}>
                  <label className="field field--wide">
                    <span>Add existing customer</span>
                    <select
                      value={memberCustomerId}
                      onChange={(e) => setMemberCustomerId(e.target.value)}
                    >
                      <option value="">Select customer</option>
                      {addableCustomers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {customerDisplayName(c.fullName)} · {c.phone}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Role</span>
                    <select value={memberRole} onChange={(e) => setMemberRole(e.target.value as LoanGroupMemberRole)}>
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="loans-wizard-actions">
                    <button type="submit" className="button primary" disabled={memberBusy || !memberCustomerId}>
                      {memberBusy ? "Adding…" : "Add member"}
                    </button>
                  </div>
                </form>
              ) : null}

              <AdminDataTable
                columns={[
                  {
                    key: "name",
                    label: "Member",
                    render: (row) => customerDisplayName(row.customerName)
                  },
                  { key: "phone", label: "Phone", render: (row) => row.customerPhone ?? "—" },
                  { key: "role", label: "Role", render: (row) => row.role },
                  {
                    key: "status",
                    label: "Status",
                    render: (row) => (
                      <span className={`status-pill status-pill--${row.status === "active" ? "active" : "inactive"}`}>
                        {row.status}
                      </span>
                    )
                  }
                ]}
                rows={detail.members ?? []}
                rowKey={(row) => row.id}
                search=""
                onSearchChange={() => {}}
                emptyMessage="No members yet — add individual customers from your registry."
                actions={
                  canCreateApplication
                    ? (row) =>
                        row.status === "active" ? (
                          <button
                            type="button"
                            className="button link"
                            disabled={memberBusy}
                            onClick={() => void handleRemoveMember(row.id)}
                          >
                            Remove
                          </button>
                        ) : null
                    : undefined
                }
              />
            </>
          ) : null}
        </section>
      ) : null}
    </LoansLayout>
  );
}
