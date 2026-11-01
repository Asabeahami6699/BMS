const DATABASE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BranchNameSource = {
  id: string;
  name: string;
  code?: string;
};

export function isDatabaseId(value: string | null | undefined): boolean {
  return Boolean(value && DATABASE_ID.test(value));
}

/** Staff-facing branch label. A database id is never shown. */
export function formatBranchLabel(
  branchId: string | null | undefined,
  branches: BranchNameSource[],
  knownName?: string | null,
  knownCode?: string | null
): string {
  const match = branchId ? branches.find((branch) => branch.id === branchId) : undefined;
  const name =
    match?.name ?? (knownName && !isDatabaseId(knownName) ? knownName : undefined);
  if (!name) {
    return "—";
  }
  const code = match?.code || knownCode || undefined;
  return code ? `${name} (${code})` : name;
}
