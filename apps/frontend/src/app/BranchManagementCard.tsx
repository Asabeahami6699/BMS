import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AppRole, Branch } from "./api";
import { deleteBranch, updateBranch } from "./api";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { RowActionsMenu } from "../components/RowActionsMenu";
import { BranchFormModal } from "./BranchFormModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { useBranchesLiveSync } from "./hooks/useBranchesLiveSync";
import { useBranchesStore } from "./stores/branchesStore";

type Props = { role: AppRole };

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

export function BranchManagementCard({ role }: Props) {
  const canManage = role === "admin";
  const { showToast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  useBranchesLiveSync();
  const { branches, loading, error, hydrate, refresh } = useBranchesStore(
    useShallow((s) => ({
      branches: s.branches,
      loading: s.loading,
      error: s.error,
      hydrate: s.hydrate,
      refresh: s.refresh
    }))
  );
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate, role]);

  useEffect(() => {
    if (error) {
      showToast(error, "error");
    }
  }, [error, showToast]);

  const filtered = useMemo(
    () => filterRowsBySearch(branches, search, ["code", "name", "status"]),
    [branches, search]
  );

  function openCreate() {
    setModalMode("create");
    setEditingBranch(null);
    setModalOpen(true);
  }

  function openEdit(branch: Branch) {
    setModalMode("edit");
    setEditingBranch(branch);
    setModalOpen(true);
  }

  async function toggleStatus(branch: Branch) {
    const next = branch.status === "active" ? "inactive" : "active";
    try {
      await updateBranch(branch.id, { status: next });
      showToast(`Branch ${next === "active" ? "activated" : "deactivated"}`, "success");
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update status", "error");
    }
  }

  async function handleDelete(branch: Branch) {
    const ok = await confirm({
      title: "Delete branch",
      message: `Delete branch "${branch.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) {
      return;
    }
    try {
      await deleteBranch(branch.id);
      showToast("Branch deleted", "success");
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete branch", "error");
    }
  }

  return (
    <>
      <section className="card admin-mgmt-card">
        <div className="admin-mgmt-head">
          <div>
            <h2>Branch management</h2>
            <p className="muted">View and manage all company branches.</p>
          </div>
          {canManage ? (
            <button type="button" className="button" onClick={openCreate}>
              + Add branch
            </button>
          ) : null}
        </div>

        {loading ? <p className="muted">Loading branches…</p> : null}

        <AdminDataTable
          columns={[
            { key: "code", label: "Code" },
            { key: "name", label: "Name" },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <span className={`status-pill status-pill--${row.status === "active" ? "active" : "inactive"}`}>
                  {row.status}
                </span>
              )
            },
            {
              key: "createdAt",
              label: "Created",
              render: (row) => formatDate(row.createdAt)
            }
          ]}
          rows={filtered}
          rowKey={(row) => row.id}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search by code or name…"
          emptyMessage={loading ? "Loading…" : "No branches match your search."}
          actions={
            canManage
              ? (row) => (
                  <RowActionsMenu
                    ariaLabel={`Actions for ${row.name}`}
                    items={[
                      { label: "Edit", onClick: () => openEdit(row) },
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
        <BranchFormModal
          open={modalOpen}
          mode={modalMode}
          branch={editingBranch}
          onClose={() => setModalOpen(false)}
          onSaved={() => void refresh()}
        />
      ) : null}

      <ConfirmDialog {...dialogProps} />
    </>
  );
}
