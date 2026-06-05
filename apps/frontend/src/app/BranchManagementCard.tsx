import { useEffect, useMemo, useState } from "react";
import type { AppRole, Branch } from "./api";
import { deleteBranch, listBranches, updateBranch } from "./api";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { RowActionsMenu } from "../components/RowActionsMenu";
import { BranchFormModal } from "./BranchFormModal";
import { useToast } from "../components/Toast";

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
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);

  async function loadBranches() {
    setLoading(true);
    try {
      const data = await listBranches();
      setBranches(data.map((b) => ({ ...b, status: b.status ?? "active" })));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to load branches", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBranches();
  }, [role]);

  const filtered = useMemo(
    () => filterRowsBySearch(branches, search, ["id", "code", "name", "status"]),
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
      await loadBranches();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to update status", "error");
    }
  }

  async function handleDelete(branch: Branch) {
    if (!window.confirm(`Delete branch "${branch.name}"? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteBranch(branch.id);
      showToast("Branch deleted", "success");
      await loadBranches();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to delete branch", "error");
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
            { key: "id", label: "Branch ID", className: "admin-table-mono" },
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
          searchPlaceholder="Search by code, name, or ID…"
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
          onSaved={() => void loadBranches()}
        />
      ) : null}
    </>
  );
}
