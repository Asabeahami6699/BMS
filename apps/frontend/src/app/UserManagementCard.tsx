import { useEffect, useMemo, useState } from "react";
import { roleRequiresTransactionPin, tellerTypeLabel } from "@bms/shared";
import { useShallow } from "zustand/react/shallow";
import type { AppRole, Branch, UserRecord } from "./api";
import { deleteUser, exportUsersCsv, updateUser } from "./api";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { RowActionsMenu } from "../components/RowActionsMenu";
import { ResetPasswordModal } from "./ResetPasswordModal";
import { ResetTransactionPinModal } from "./ResetTransactionPinModal";
import { UserFormModal } from "./UserFormModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { useBranchesLiveSync } from "./hooks/useBranchesLiveSync";
import { useBranchesStore } from "./stores/branchesStore";
import { useHrDeskStore } from "./stores/hrDeskStore";

type Props = {
  role: AppRole;
};

function formatDate(value?: string): string {
  if (!value) {
    return "—";
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function branchLabel(branchId: string | undefined, branches: Branch[]): string {
  if (!branchId) {
    return "—";
  }
  const match = branches.find((b) => b.id === branchId);
  return match ? `${match.name} (${match.code})` : branchId;
}

export function UserManagementCard({ role }: Props) {
  const canManage = role === "admin";
  const { showToast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  useBranchesLiveSync();
  const branches = useBranchesStore((s) => s.branches);
  const {
    users,
    loading,
    rosterError,
    hydrateRoster,
    refreshRoster,
    startLiveSync,
    stopLiveSync
  } = useHrDeskStore(
    useShallow((s) => ({
      users: s.users,
      loading: s.rosterLoading,
      rosterError: s.rosterError,
      hydrateRoster: s.hydrateRoster,
      refreshRoster: s.refreshRoster,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [passwordResetUser, setPasswordResetUser] = useState<UserRecord | null>(null);
  const [resetPinOpen, setResetPinOpen] = useState(false);
  const [pinResetUser, setPinResetUser] = useState<UserRecord | null>(null);

  useEffect(() => {
    hydrateRoster();
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrateRoster, startLiveSync, stopLiveSync]);

  useEffect(() => {
    if (rosterError) {
      showToast(rosterError, "error");
    }
  }, [rosterError, showToast]);

  const filtered = useMemo(
    () =>
      filterRowsBySearch(users, search, [
        "userId",
        "email",
        "fullName",
        "role",
        "scopeType",
        "branchId",
        "status",
        "createdBy",
        "createdByName"
      ]),
    [users, search]
  );

  function openCreate() {
    setModalMode("create");
    setEditingUser(null);
    setModalOpen(true);
  }

  function openEdit(user: UserRecord) {
    setModalMode("edit");
    setEditingUser(user);
    setModalOpen(true);
  }

  function openReset(user: UserRecord) {
    setPasswordResetUser(user);
    setResetOpen(true);
  }

  function openResetPin(user: UserRecord) {
    setPinResetUser(user);
    setResetPinOpen(true);
  }

  async function toggleStatus(user: UserRecord) {
    const next = user.status === "active" ? "inactive" : "active";
    try {
      await updateUser(user.userId, { status: next });
      showToast(`User ${next === "active" ? "activated" : "deactivated"}`, "success");
      await refreshRoster();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to update status", "error");
    }
  }

  async function handleDelete(user: UserRecord) {
    const ok = await confirm({
      title: "Delete user",
      message: `Delete user "${user.fullName ?? user.email}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) {
      return;
    }
    try {
      await deleteUser(user.userId);
      showToast("User deleted", "success");
      await refreshRoster();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to delete user", "error");
    }
  }

  async function handleExportCsv() {
    try {
      const csv = await exportUsersCsv();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "users.csv");
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("Users CSV exported", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to export users CSV", "error");
    }
  }

  return (
    <>
      <section className="card admin-mgmt-card admin-mgmt-card--users">
        <div className="admin-mgmt-head">
          <div>
            <h2>User management</h2>
            <p className="muted">Staff accounts with roles, scope, and login access.</p>
          </div>
          {canManage ? (
            <div className="admin-mgmt-head-actions">
              <button type="button" className="button secondary" onClick={() => void handleExportCsv()}>
                Export CSV
              </button>
              <button type="button" className="button" onClick={openCreate}>
                + Add user
              </button>
            </div>
          ) : null}
        </div>

        {loading ? <p className="muted">Loading users…</p> : null}

        <AdminDataTable
          columns={[
            { key: "fullName", label: "Name", render: (row) => row.fullName ?? "—" },
            {
              key: "email",
              label: "Email",
              className: "admin-table-email",
              render: (row) => (
                <span className="admin-table-email__text" title={row.email}>
                  {row.email}
                </span>
              )
            },
            {
              key: "role",
              label: "Role",
              className: "admin-table-role",
              render: (row) => row.role.replace(/_/g, " ")
            },
            {
              key: "tellerType",
              label: "Teller type",
              render: (row) =>
                row.role === "teller" && row.tellerType ? tellerTypeLabel(row.tellerType) : "—"
            },
            {
              key: "scopeType",
              label: "Scope",
              render: (row) => (row.scopeType === "head_office" ? "Head office" : "Branch")
            },
            {
              key: "branchId",
              label: "Branch",
              render: (row) => branchLabel(row.branchId, branches)
            },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <span className={`status-pill status-pill--${row.status === "active" ? "active" : "inactive"}`}>
                  {row.status}
                </span>
              )
            },
            { key: "userId", label: "User ID", className: "admin-table-mono admin-table-col--hide-desktop" },
            {
              key: "createdBy",
              label: "Created by",
              render: (row) => row.createdByName ?? (row.createdBy === "system" ? "System" : row.createdBy)
            },
            {
              key: "createdAt",
              label: "Created",
              render: (row) => formatDate(row.createdAt)
            }
          ]}
          rows={filtered}
          rowKey={(row) => row.userId}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search name, email, role, branch…"
          emptyMessage={loading ? "Loading…" : "No users match your search."}
          actions={
            canManage
              ? (row) => (
                  <RowActionsMenu
                    ariaLabel={`Actions for ${row.fullName ?? row.email}`}
                    items={[
                      { label: "Edit", onClick: () => openEdit(row) },
                      { label: "Reset password", onClick: () => openReset(row) },
                      ...(roleRequiresTransactionPin(row.role)
                        ? [{ label: "Reset transaction PIN", onClick: () => openResetPin(row) }]
                        : []),
                      {
                        label: row.status === "active" ? "Deactivate" : "Activate",
                        onClick: () => void toggleStatus(row)
                      },
                      { label: "Delete", onClick: () => void handleDelete(row), danger: true }
                    ]}
                  />
                )
              : undefined
          }
        />
      </section>

      {canManage ? (
        <>
          <UserFormModal
            open={modalOpen}
            mode={modalMode}
            user={editingUser}
            branches={branches}
            onClose={() => setModalOpen(false)}
            onSaved={() => void refreshRoster()}
          />
          <ResetPasswordModal
            open={resetOpen}
            user={passwordResetUser}
            onClose={() => setResetOpen(false)}
          />
          <ResetTransactionPinModal
            open={resetPinOpen}
            user={pinResetUser}
            onClose={() => setResetPinOpen(false)}
          />
        </>
      ) : null}

      <ConfirmDialog {...dialogProps} />
    </>
  );
}
