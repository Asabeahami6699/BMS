import { useEffect, useMemo, useState } from "react";
import { tellerTypeLabel } from "@bms/shared";
import { listBranches, listUsers, type Branch, type UserRecord } from "../../api";
import { AdminDataTable, filterRowsBySearch } from "../../../components/AdminDataTable";
import { HrSectionShell } from "./HrSectionShell";

type Props = { displayName?: string };

export function HrBranchAssignmentsPage({ displayName }: Props) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchFilter, setBranchFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([listUsers(), listBranches().catch(() => [])])
      .then(([userRows, branchRows]) => {
        setUsers(userRows);
        setBranches(branchRows);
      })
      .finally(() => setLoading(false));
  }, []);

  const scoped = useMemo(() => {
    let rows = users.filter((u) => u.status === "active");
    if (branchFilter === "head_office") {
      rows = rows.filter((u) => u.scopeType === "head_office");
    } else if (branchFilter) {
      rows = rows.filter((u) => u.branchId === branchFilter);
    }
    return rows;
  }, [users, branchFilter]);

  const filtered = filterRowsBySearch(scoped, search, [
    "fullName",
    "email",
    "role"
  ] as (keyof UserRecord)[]);

  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);

  return (
    <HrSectionShell
      title="Branch assignments"
      subtitle="Who works at each branch — tellers, CS, back office, and coordinators."
      displayName={displayName}
      loading={loading}
    >
      <section className="card">
        <label className="field">
          <span>Filter by branch</span>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All assignments</option>
            <option value="head_office">Head office only</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </label>
      </section>

      <AdminDataTable
        variant="desk"
        title="Branch assignments"
        subtitle="Where each employee is posted and their teller slot."
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search staff…"
        columns={[
          { key: "name", label: "Employee" },
          { key: "role", label: "Role" },
          { key: "scope", label: "Scope" },
          { key: "branch", label: "Branch" },
          { key: "teller", label: "Teller slot" }
        ]}
        rows={filtered.map((u) => ({
          id: u.userId,
          name: u.fullName ?? u.email,
          role: u.role.replace(/_/g, " "),
          scope: u.scopeType === "head_office" ? "Head office" : "Branch",
          branch: u.branchId
            ? `${branchById.get(u.branchId)?.name ?? u.branchId} (${branchById.get(u.branchId)?.code ?? ""})`
            : "—",
          teller: u.role === "teller" && u.tellerType ? tellerTypeLabel(u.tellerType) : "—"
        }))}
        rowKey={(r) => r.id}
        emptyMessage={loading ? "Loading…" : "No staff for this filter."}
      />
    </HrSectionShell>
  );
}
