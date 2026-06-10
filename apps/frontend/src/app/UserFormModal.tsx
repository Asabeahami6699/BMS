import {
  BUILTIN_ROLE_LABELS,
  isBuiltinRole,
  roleRequiresBranch,
  TELLER_TYPE_OPTIONS,
  tellerTypeLabel,
  TENANT_STAFF_ROLES
} from "@bms/shared";
import { FormEvent, useEffect, useState } from "react";
import type { AppRole, Branch, RoleDefinition, UserRecord } from "./api";
import {
  assignRole,
  createUser,
  getRoleAssignments,
  getRoles,
  unassignRole,
  updateUser
} from "./api";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";

type Mode = "create" | "edit";

type CreateDefaults = {
  role?: string;
  scopeType?: "head_office" | "branch";
  customRoleKeys?: string[];
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

async function syncCustomRoleAssignments(
  userId: string,
  nextKeys: string[],
  previousKeys: string[]
): Promise<void> {
  const nextSet = new Set(nextKeys);
  const prevSet = new Set(previousKeys);
  for (const roleKey of nextKeys) {
    if (!prevSet.has(roleKey)) {
      await assignRole({ userId, roleKey });
    }
  }
  for (const roleKey of previousKeys) {
    if (!nextSet.has(roleKey)) {
      await unassignRole({ userId, roleKey });
    }
  }
}

export function UserFormModal({ open, mode, user, branches, createDefaults, onClose, onSaved }: Props) {
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("ChangeMe123!");
  const [userRole, setUserRole] = useState<string>("field_agent");
  const [scopeType, setScopeType] = useState<"head_office" | "branch">("branch");
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [allTenantRoles, setAllTenantRoles] = useState<RoleDefinition[]>([]);
  const [selectedCustomRoleKeys, setSelectedCustomRoleKeys] = useState<string[]>([]);
  const [initialCustomRoleKeys, setInitialCustomRoleKeys] = useState<string[]>([]);
  const [tellerType, setTellerType] = useState<"" | "1" | "2" | "3" | "4">("");

  const tenantJobTitles = allTenantRoles.filter((role) => role.roleKind === "job_title");
  const extraDutyRoles = allTenantRoles.filter(
    (role) => (role.roleKind ?? "extra_duties") === "extra_duties"
  );

  const requiresBranch = isBuiltinRole(userRole) && roleRequiresBranch(userRole);
  const activeBranches = branches.filter((b) => b.status !== "inactive");

  useEffect(() => {
    if (!open) {
      return;
    }
    void getRoles()
      .then(setAllTenantRoles)
      .catch(() => setAllTenantRoles([]));

    if (mode === "edit" && user) {
      void getRoleAssignments()
        .then((rows) => {
          const keys = rows.filter((row) => row.userId === user.userId).map((row) => row.roleKey);
          setSelectedCustomRoleKeys(keys);
          setInitialCustomRoleKeys(keys);
        })
        .catch(() => {
          setSelectedCustomRoleKeys([]);
          setInitialCustomRoleKeys([]);
        });
    } else {
      const preset = createDefaults?.customRoleKeys ?? [];
      setSelectedCustomRoleKeys(preset);
      setInitialCustomRoleKeys([]);
    }
  }, [open, mode, user, createDefaults?.customRoleKeys]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (mode === "edit" && user) {
      setFullName(user.fullName ?? "");
      setEmail(user.email);
      setUserRole(user.role);
      const scope =
        isBuiltinRole(user.role) && roleRequiresBranch(user.role) ? "branch" : user.scopeType;
      setScopeType(scope);
      const firstBranch = branches.find((b) => b.status !== "inactive");
      setBranchId(user.branchId ?? firstBranch?.id ?? "");
      setStatus(user.status ?? "active");
      setTellerType(user.role === "teller" && user.tellerType ? String(user.tellerType) as "1" | "2" | "3" | "4" : "");
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
      setTellerType(defaultRole === "teller" ? "1" : "");
    }
  }, [open, mode, user, branches, createDefaults]);

  function handleRoleChange(role: string) {
    setUserRole(role);
    if (role === "teller") {
      setTellerType((prev) => prev || "1");
    } else {
      setTellerType("");
    }
    if (isBuiltinRole(role) && roleRequiresBranch(role)) {
      setScopeType("branch");
      if (!branchId && activeBranches[0]) {
        setBranchId(activeBranches[0].id);
      }
    }
  }

  function toggleCustomRole(roleKey: string) {
    setSelectedCustomRoleKeys((prev) =>
      prev.includes(roleKey) ? prev.filter((key) => key !== roleKey) : [...prev, roleKey]
    );
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
    if (userRole === "teller" && !tellerType) {
      showToast("Select teller type (Teller 1–4)", "error");
      return;
    }

    setSubmitting(true);
    const resolvedTellerType =
      userRole === "teller" ? (Number(tellerType) as 1 | 2 | 3 | 4) : null;
    const effectiveScope = requiresBranch ? "branch" : scopeType;
    const effectiveBranch = resolveBranchIdForSubmit();
    try {
      if (mode === "create") {
        const created = await createUser({
          email,
          password,
          fullName,
          role: userRole,
          scopeType: effectiveScope,
          branchId: effectiveScope === "branch" ? (effectiveBranch ?? undefined) : undefined,
          tellerType: resolvedTellerType
        });
        if (selectedCustomRoleKeys.length > 0) {
          await syncCustomRoleAssignments(created.userId, selectedCustomRoleKeys, []);
        }
        showToast("User created", "success");
      } else if (user) {
        await updateUser(user.userId, {
          email,
          fullName,
          role: userRole,
          scopeType: effectiveScope,
          branchId: effectiveScope === "branch" ? effectiveBranch ?? null : null,
          tellerType: resolvedTellerType,
          status
        });
        await syncCustomRoleAssignments(user.userId, selectedCustomRoleKeys, initialCustomRoleKeys);
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
          ? "Set a system job title plus optional custom roles. Field agents must be assigned to a branch."
          : "Update profile, job title, custom roles, scope, branch, or account status."
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
          <span>Job title</span>
          <select value={userRole} onChange={(e) => handleRoleChange(e.target.value)}>
            <optgroup label="System job titles">
              {TENANT_STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {BUILTIN_ROLE_LABELS[r]}
                </option>
              ))}
            </optgroup>
            {tenantJobTitles.length > 0 ? (
              <optgroup label="Your company job titles">
                {tenantJobTitles.map((jobTitle) => (
                  <option key={jobTitle.roleKey} value={jobTitle.roleKey}>
                    {jobTitle.displayName}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <small className="muted">
            Primary access level — system titles or custom titles you create under Roles &amp; permissions.
          </small>
        </label>

        {userRole === "teller" ? (
          <label className="field">
            <span>Teller type</span>
            <select
              value={tellerType}
              onChange={(e) => setTellerType(e.target.value as "" | "1" | "2" | "3" | "4")}
              required
            >
              <option value="">Select teller slot…</option>
              {TELLER_TYPE_OPTIONS.map((slot) => (
                <option key={slot} value={String(slot)}>
                  {tellerTypeLabel(slot)}
                </option>
              ))}
            </select>
            <small className="muted">
              Cash drawer slot at the branch — e.g. Teller 1 through Teller 4.
            </small>
          </label>
        ) : null}

        <fieldset className="field roles-page__custom-role-picker">
          <legend>Extra duty bundles (optional)</legend>
          <small className="muted">
            Add-on permissions on top of the job title above. Create these on the Custom roles tab.
          </small>
          {extraDutyRoles.length === 0 ? (
            <p className="muted">No extra duty bundles yet — create them on the Custom roles tab first.</p>
          ) : (
            <div className="duty-grid">
              {extraDutyRoles.map((customRole) => (
                <label key={customRole.roleKey} className="duty-item">
                  <input
                    type="checkbox"
                    checked={selectedCustomRoleKeys.includes(customRole.roleKey)}
                    onChange={() => toggleCustomRole(customRole.roleKey)}
                  />
                  <span>
                    <strong>{customRole.displayName}</strong>
                    <small>{customRole.roleKey}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

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
