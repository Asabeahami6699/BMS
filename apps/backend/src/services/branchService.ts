import { getSupabaseAdminClient } from "../config/supabaseClient.js";

type Branch = {
  id: string;
  code: string;
  name: string;
  status: "active" | "inactive";
  createdAt?: string;
};

type CreateBranchInput = { id?: string; code: string; name: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(id: string): boolean {
  return UUID_RE.test(id);
}

function newLocalBranchId(): string {
  return `branch-${crypto.randomUUID().slice(0, 8)}`;
}
type UpdateBranchInput = { code?: string; name?: string; status?: "active" | "inactive" };

const branchStore = new Map<string, Branch[]>();

function ensureTenantBranches(tenantId: string): Branch[] {
  const existing = branchStore.get(tenantId);
  if (existing) {
    return existing;
  }
  const seeded: Branch[] = [
    { id: "branch-a", code: "BRA", name: "Branch A", status: "active" },
    { id: "branch-b", code: "BRB", name: "Branch B", status: "active" }
  ];
  branchStore.set(tenantId, seeded);
  return seeded;
}

export async function listBranches(tenantId: string): Promise<Branch[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("branches")
      .select("id, code, name, status, created_at")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true });
    if (error) {
      throw new Error(`Failed to fetch branches: ${error.message}`);
    }
    return (data ?? []).map((branch) => ({
      id: branch.id,
      code: branch.code,
      name: branch.name,
      status: branch.status === "inactive" ? "inactive" : "active",
      createdAt: branch.created_at ?? undefined
    }));
  }

  return ensureTenantBranches(tenantId);
}

/** Maps demo/local branch ids (e.g. branch-a) to real Supabase UUIDs when connected. */
export async function resolveBranchId(
  tenantId: string,
  branchRef?: string
): Promise<string | undefined> {
  const ref = branchRef?.trim();
  if (!ref) {
    return undefined;
  }

  const branches = await listBranches(tenantId).catch(() => [] as Branch[]);
  if (branches.length === 0) {
    return isValidUuid(ref) ? ref : ref;
  }

  if (isValidUuid(ref)) {
    const match = branches.find((b) => b.id === ref);
    return match?.id ?? ref;
  }

  const byExactId = branches.find((b) => b.id === ref);
  if (byExactId) {
    return byExactId.id;
  }

  const codeNorm = ref.toLowerCase();
  const byCode = branches.find((b) => b.code.toLowerCase() === codeNorm);
  if (byCode) {
    return byCode.id;
  }

  if (ref === "branch-a" || ref === "main") {
    const preferred = branches.find(
      (b) => b.code.toUpperCase() === "MAIN" || b.code.toUpperCase() === "BRA"
    );
    return (preferred ?? branches.find((b) => b.status === "active"))?.id;
  }

  if (ref === "branch-b") {
    const second = branches.filter((b) => b.status === "active")[1];
    return second?.id ?? branches[1]?.id;
  }

  return undefined;
}

export async function createBranch(tenantId: string, input: CreateBranchInput): Promise<Branch> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const insertRow: Record<string, unknown> = {
      tenant_id: tenantId,
      code: input.code.trim(),
      name: input.name.trim(),
      status: "active"
    };

    if (input.id && isValidUuid(input.id)) {
      const { data: existing, error: existingErr } = await supabase
        .from("branches")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", input.id)
        .maybeSingle();
      if (existingErr) {
        throw new Error(`Failed to check branch: ${existingErr.message}`);
      }
      if (existing) {
        throw new Error("Branch already exists");
      }
      insertRow.id = input.id;
    }

    const { data, error } = await supabase
      .from("branches")
      .insert(insertRow)
      .select("id, code, name, status, created_at")
      .single();

    if (error) {
      if (error.message.includes("status") && insertRow.status !== undefined) {
        delete insertRow.status;
        const retry = await supabase
          .from("branches")
          .insert(insertRow)
          .select("id, code, name, created_at")
          .single();
        if (retry.error || !retry.data) {
          throw new Error(`Failed to create branch: ${retry.error?.message ?? error.message}`);
        }
        return {
          id: retry.data.id,
          code: retry.data.code,
          name: retry.data.name,
          status: "active",
          createdAt: retry.data.created_at ?? undefined
        };
      }
      throw new Error(`Failed to create branch: ${error.message}`);
    }

    return {
      id: data.id,
      code: data.code,
      name: data.name,
      status: data.status === "inactive" ? "inactive" : "active",
      createdAt: data.created_at ?? undefined
    };
  }

  const branchId = input.id && !isValidUuid(input.id) ? input.id : newLocalBranchId();
  const branch: Branch = {
    id: branchId,
    code: input.code,
    name: input.name,
    status: "active",
    createdAt: new Date().toISOString()
  };

  const branches = ensureTenantBranches(tenantId);
  if (branches.some((entry) => entry.id === branch.id)) {
    throw new Error("Branch already exists");
  }
  branchStore.set(tenantId, [...branches, branch]);
  return branch;
}

export async function updateBranch(
  tenantId: string,
  branchId: string,
  input: UpdateBranchInput
): Promise<Branch> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const payload: { code?: string; name?: string; status?: string } = {};
    if (input.code !== undefined) {
      payload.code = input.code;
    }
    if (input.name !== undefined) {
      payload.name = input.name;
    }
    if (input.status !== undefined) {
      payload.status = input.status;
    }
    const { data, error } = await supabase
      .from("branches")
      .update(payload)
      .eq("tenant_id", tenantId)
      .eq("id", branchId)
      .select("id, code, name, status, created_at")
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to update branch: ${error.message}`);
    }
    if (!data) {
      throw new Error("Branch not found");
    }
    return {
      id: data.id,
      code: data.code,
      name: data.name,
      status: data.status === "inactive" ? "inactive" : "active",
      createdAt: data.created_at ?? undefined
    };
  }

  const branches = ensureTenantBranches(tenantId);
  const target = branches.find((entry) => entry.id === branchId);
  if (!target) {
    throw new Error("Branch not found");
  }
  if (input.code !== undefined) {
    target.code = input.code;
  }
  if (input.name !== undefined) {
    target.name = input.name;
  }
  if (input.status !== undefined) {
    target.status = input.status;
  }
  branchStore.set(tenantId, branches);
  return target;
}

async function branchHasCustomers(tenantId: string, branchId: string): Promise<boolean> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { count, error } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("home_branch_id", branchId);
    if (error) {
      throw new Error(`Failed to check branch customers: ${error.message}`);
    }
    return (count ?? 0) > 0;
  }
  return false;
}

export async function deleteBranch(tenantId: string, branchId: string): Promise<void> {
  if (await branchHasCustomers(tenantId, branchId)) {
    throw new Error("Cannot delete branch with assigned customers. Set inactive instead.");
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { count: userCount, error: userErr } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId);
    if (userErr) {
      throw new Error(`Failed to check branch users: ${userErr.message}`);
    }
    if ((userCount ?? 0) > 0) {
      throw new Error("Cannot delete branch with assigned users. Reassign users or set inactive.");
    }

    const { error } = await supabase.from("branches").delete().eq("tenant_id", tenantId).eq("id", branchId);
    if (error) {
      throw new Error(`Failed to delete branch: ${error.message}`);
    }
    return;
  }

  const branches = ensureTenantBranches(tenantId);
  const next = branches.filter((entry) => entry.id !== branchId);
  if (next.length === branches.length) {
    throw new Error("Branch not found");
  }
  branchStore.set(tenantId, next);
}
