/** True when Supabase/PostgREST reports a missing table or column (migrations not applied yet). */
export function isMissingSupabaseResource(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("could not find the table") ||
    m.includes("could not find the column") ||
    m.includes("schema cache") ||
    m.includes("does not exist") ||
    m.includes("pgrst205")
  );
}
