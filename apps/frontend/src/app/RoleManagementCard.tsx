import { useEffect, useState } from "react";
import type { AppRole } from "./api";
import { assignRole, createRole, getRoleAssignments, getRoles, getTenantId } from "./api";
import { subscribeToTenantRealtime } from "./realtime";

type Props = {
  role: AppRole;
};

const dutyOptions = [
  "roles.create",
  "roles.read",
  "roles.assign",
  "users.create",
  "users.read",
  "branches.create",
  "branches.update",
  "branches.read",
  "customers.create",
  "customers.read",
  "transactions.create.daily_susu",
  "transactions.create.deposit",
  "transactions.create.withdrawal",
  "transactions.read",
  "ledger.read",
  "reports.read",
  "payroll.read",
  "payroll.run",
  "commission_policy.update",
  "commission_policy.read"
];

export function RoleManagementCard({ role }: Props) {
  const canManageRoles = role === "admin";
  const [roleKey, setRoleKey] = useState("branch_supervisor");
  const [displayName, setDisplayName] = useState("Branch Supervisor");
  const [duties, setDuties] = useState<string[]>(["customers.read", "transactions.read"]);
  const [assignUserId, setAssignUserId] = useState("demo-fieldagent");
  const [assignRoleKey, setAssignRoleKey] = useState("branch_supervisor");
  const [status, setStatus] = useState("Loading roles...");
  const [roles, setRoles] = useState<Array<{ roleKey: string; displayName: string; duties: string[] }>>([]);
  const [assignments, setAssignments] = useState<Array<{ userId: string; roleKey: string }>>([]);

  async function loadRoles() {
    try {
      const data = await getRoles();
      setRoles(data);
      const assignmentData = await getRoleAssignments();
      setAssignments(assignmentData);
      setStatus("Roles loaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load roles.");
    }
  }

  useEffect(() => {
    void loadRoles();
    const unsubscribe = subscribeToTenantRealtime({
      tenantId: getTenantId(),
      tables: ["tenant_roles", "user_role_assignments"],
      onChange: () => {
        void loadRoles();
      }
    });

    return () => unsubscribe();
  }, [role]);

  function toggleDuty(duty: string) {
    setDuties((prev) => (prev.includes(duty) ? prev.filter((item) => item !== duty) : [...prev, duty]));
  }

  async function handleCreateRole() {
    try {
      setStatus("Creating role...");
      await createRole({
        roleKey,
        displayName,
        duties
      });
      setStatus("Role created.");
      await loadRoles();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create role.");
    }
  }

  async function handleAssignRole() {
    try {
      setStatus("Assigning role...");
      await assignRole({ userId: assignUserId, roleKey: assignRoleKey });
      await loadRoles();
      setStatus("Role assigned.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to assign role.");
    }
  }

  return (
    <section className="card">
      <h2>Role & Duty Management</h2>
      <p className="muted">Admin can create custom roles and assign duties to those roles.</p>

      <label className="field">
        <span>Role Key</span>
        <input value={roleKey} disabled={!canManageRoles} onChange={(event) => setRoleKey(event.target.value)} />
      </label>
      <label className="field">
        <span>Display Name</span>
        <input
          value={displayName}
          disabled={!canManageRoles}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>

      <div className="field">
        <span>Duties (permissions)</span>
        <div className="duty-grid">
          {dutyOptions.map((duty) => (
            <label key={duty} className="duty-item">
              <input
                type="checkbox"
                checked={duties.includes(duty)}
                disabled={!canManageRoles}
                onChange={() => toggleDuty(duty)}
              />
              <small>{duty}</small>
            </label>
          ))}
        </div>
      </div>

      <button type="button" className="button" disabled={!canManageRoles} onClick={handleCreateRole}>
        Create Role
      </button>

      <label className="field">
        <span>Assign Role To User ID</span>
        <input
          value={assignUserId}
          disabled={!canManageRoles}
          onChange={(event) => setAssignUserId(event.target.value)}
        />
      </label>

      <label className="field">
        <span>Role Key To Assign</span>
        <input
          value={assignRoleKey}
          disabled={!canManageRoles}
          onChange={(event) => setAssignRoleKey(event.target.value)}
        />
      </label>

      <button type="button" className="button" disabled={!canManageRoles} onClick={handleAssignRole}>
        Assign Role
      </button>

      <p className="muted">{status}</p>
      <div className="lines">
        {roles.map((entry) => (
          <div key={entry.roleKey} className="line">
            <span>{entry.displayName}</span>
            <small>{entry.duties.length} duties</small>
          </div>
        ))}
      </div>
      <hr />
      <h3>Assignments</h3>
      <div className="lines">
        {assignments.slice(0, 6).map((entry) => (
          <div key={`${entry.userId}-${entry.roleKey}`} className="line">
            <span>{entry.userId}</span>
            <small>{entry.roleKey}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
