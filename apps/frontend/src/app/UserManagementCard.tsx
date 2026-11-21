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
import { formatBranchLabel } from "./branchDisplay";

type Props = {
  role: AppRole;
};

function formatDate(value?: string): string {
  if (!value) {
    return "—";
  }
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  } catch {
    return value;
  }
}

function formatDateFull(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function branchLabel(branchId: string | undefined, branches: Branch[]): string {
  return formatBranchLabel(branchId, branches);
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
            {
              key: "fullName",
              label: "Name",
              className: "admin-table-name",
              render: (row) => (
                <span className="admin-table-ellipsis" title={row.fullName ?? undefined}>
                  {row.fullName ?? "—"}
                </span>
              )
            },
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
              render: (row) => {
                const base = row.role.replace(/_/g, " ");
                const label =
                  row.role === "teller" && row.tellerType
                    ? `${base} · ${tellerTypeLabel(row.tellerType)}`
                    : base;
                return (
                  <span className="admin-table-ellipsis" title={label}>
                    {label}
                  </span>
                );
              }
            },
            {
              key: "branchId",
              label: "Branch / Scope",
              className: "admin-table-branch",
              render: (row) => {
                const label =
                  row.scopeType === "head_office"
                    ? "Head office"
                    : branchLabel(row.branchId, branches);
                return (
                  <span className="admin-table-ellipsis" title={label}>
                    {label}
                  </span>
                );
              }
            },
            {
              key: "status",
              label: "Status",
              className: "admin-table-status",
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
              className: "admin-table-created-by",
              render: (row) => {
                const label =
                  row.createdByName ?? (row.createdBy === "system" ? "System" : row.createdBy);
                return (
                  <span className="admin-table-ellipsis" title={label}>
                    {label}
                  </span>
                );
              }
            },
            {
              key: "createdAt",
              label: "Created",
              className: "admin-table-created",
              render: (row) => (
                <span className="admin-table-ellipsis" title={formatDateFull(row.createdAt)}>
                  {formatDate(row.createdAt)}
                </span>
              )
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
