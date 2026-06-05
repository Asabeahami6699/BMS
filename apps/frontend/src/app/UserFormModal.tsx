import { roleRequiresBranch } from "@bms/shared";
import { FormEvent, useEffect, useState } from "react";
import type { AppRole, Branch, UserRecord } from "./api";
import { createUser, updateUser } from "./api";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";

const TENANT_ROLES: AppRole[] = [
  "admin",
  "field_agent",
  "coordinator",
  "auditor",
  "accountant",
  "teller",
  "customer_service"
];

type Mode = "create" | "edit";

type CreateDefaults = {
  role?: AppRole;
  scopeType?: "head_office" | "branch";
};

type Props = {
  open: boolean;
  mode: Mode;
  user: UserRecord | null;
  branches: Branch[];
  createDefaults?: CreateDefaults;
  onClose: () => void;
  onSaved: () => void;
};

export function UserFormModal({ open, mode, user, branches, createDefaults, onClose, onSaved }: Props) {
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("ChangeMe123!");
  const [userRole, setUserRole] = useState<AppRole>("field_agent");
  const [scopeType, setScopeType] = useState<"head_office" | "branch">("branch");
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");

  const requiresBranch = roleRequiresBranch(userRole);
  const activeBranches = branches.filter((b) => b.status !== "inactive");

  useEffect(() => {
    if (!open) {
      return;
    }
    if (mode === "edit" && user) {
      setFullName(user.fullName ?? "");
      setEmail(user.email);
      setUserRole(user.role);
      const scope = roleRequiresBranch(user.role) ? "branch" : user.scopeType;
      setScopeType(scope);
      const firstBranch = branches.find((b) => b.status !== "inactive");
      setBranchId(user.branchId ?? firstBranch?.id ?? "");
      setStatus(user.status ?? "active");
    } else {
      const defaultRole = createDefaults?.role ?? "field_agent";
      const defaultScope = createDefaults?.scopeType ?? (defaultRole === "coordinator" ? "head_office" : "branch");
      setFullName("");
      setEmail("");
      setPassword("ChangeMe123!");
      setUserRole(defaultRole);
      setScopeType(defaultScope);
      const firstBranch = branches.find((b) => b.status !== "inactive");
      setBranchId(firstBranch?.id ?? "");
      setStatus("active");
    }
  }, [open, mode, user, branches, createDefaults]);

  function handleRoleChange(role: AppRole) {
    setUserRole(role);
    if (roleRequiresBranch(role)) {
      setScopeType("branch");
      if (!branchId && activeBranches[0]) {
        setBranchId(activeBranches[0].id);
      }
    }
  }

  function resolveBranchIdForSubmit(): string | undefined | null {
    if (requiresBranch || scopeType === "branch") {
      return branchId.trim() || undefined;
    }
    return mode === "edit" ? null : undefined;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if ((requiresBranch || scopeType === "branch") && !branchId.trim()) {
      showToast(
        requiresBranch
          ? "Select a branch for this field agent."
          : "Select a branch when scope is branch.",
        "error"
      );
      return;
    }
    if (requiresBranch && activeBranches.length === 0) {
      showToast("Create a branch first before adding a field agent.", "error");
      return;
    }

    setSubmitting(true);
    const effectiveScope = requiresBranch ? "branch" : scopeType;
    const effectiveBranch = resolveBranchIdForSubmit();
    try {
      if (mode === "create") {
        await createUser({
          email,
          password,
          fullName,
          role: userRole,
          scopeType: effectiveScope,
          branchId:
            effectiveScope === "branch" ? (effectiveBranch ?? undefined) : undefined
        });
        showToast("User created", "success");
      } else if (user) {
        await updateUser(user.userId, {
          email,
          fullName,
          role: userRole,
          scopeType: effectiveScope,
          branchId: effectiveScope === "branch" ? effectiveBranch ?? null : null,
          status
        });
        showToast("User updated", "success");
      }
      onSaved();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save user", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title={mode === "create" ? "Add user" : "Edit user"}
      subtitle={
        mode === "create"
          ? "Create a staff login with email and password. Field agents must be assigned to a branch."
          : "Update profile, role, scope, branch, or account status."
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="user-form"
            className="button"
            disabled={submitting || (requiresBranch && activeBranches.length === 0)}
          >
            {submitting ? "Saving…" : mode === "create" ? "Create user" : "Save changes"}
          </button>
        </>
      }
    >
      <form id="user-form" className="stack-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Full name</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label className="field">
          <span>Email (login)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        {mode === "create" ? (
          <label className="field">
            <span>Password</span>
            <input
              type="text"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
        ) : null}
        <label className="field">
          <span>Role</span>
          <select value={userRole} onChange={(e) => handleRoleChange(e.target.value as AppRole)}>
            {TENANT_ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        {requiresBranch ? (
          <label className="field">
            <span>Branch</span>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
              <option value="">Select branch</option>
              {activeBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
            <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
              Required for field agents — used for customer registration and collections.
            </p>
          </label>
        ) : (
          <>
            <label className="field">
              <span>Scope</span>
              <select
                value={scopeType}
                onChange={(e) => setScopeType(e.target.value as "head_office" | "branch")}
              >
                <option value="head_office">Head office</option>
                <option value="branch">Branch</option>
              </select>
            </label>
            {scopeType === "branch" ? (
              <label className="field">
                <span>Branch</span>
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
                  <option value="">Select branch</option>
                  {activeBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        )}
        {mode === "edit" ? (
          <label className="field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as "active" | "inactive")}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        ) : null}
      </form>
    </Modal>
  );
}
