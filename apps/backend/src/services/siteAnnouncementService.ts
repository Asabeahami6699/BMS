import {
  createSiteAnnouncementSchema,
  isSiteAnnouncementLive,
  siteAnnouncementSchema,
  updateSiteAnnouncementSchema,
  type AnnouncementScope,
  type CreateSiteAnnouncementInput,
  type SiteAnnouncement,
  type UpdateSiteAnnouncementInput
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";

const memoryStore: SiteAnnouncement[] = [];

function isMissingAnnouncementsTable(message: string | undefined): boolean {
  if (!message) return false;
  return /site_announcements|does not exist|schema cache|relation/i.test(message);
}

function mapRow(row: Record<string, unknown>): SiteAnnouncement {
  return siteAnnouncementSchema.parse({
    id: String(row.id),
    scope: row.scope === "platform" ? "platform" : "tenant",
    tenantId: row.tenant_id ? String(row.tenant_id) : null,
    title: row.title ? String(row.title) : undefined,
    message: String(row.message ?? ""),
    tone: row.tone ?? "info",
    isActive: row.is_active !== false,
    dismissible: row.dismissible !== false,
    startsAt: String(row.starts_at ?? row.created_at ?? new Date().toISOString()),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    durationMinutes:
      row.duration_minutes != null && Number.isFinite(Number(row.duration_minutes))
        ? Number(row.duration_minutes)
        : null,
    createdBy: String(row.created_by ?? "system"),
    createdByName: row.created_by_name ? String(row.created_by_name) : undefined,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString())
  });
}

function sortActivePriority(rows: SiteAnnouncement[]): SiteAnnouncement[] {
  return [...rows].sort((a, b) => {
    if (a.scope !== b.scope) {
      return a.scope === "platform" ? -1 : 1;
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function resolveExpiryFromCreate(
  input: CreateSiteAnnouncementInput,
  nowMs: number
): { expiresAt: string | null; durationMinutes: number | null } {
  if (input.timerMode === "none") {
    return { expiresAt: null, durationMinutes: null };
  }
  if (input.timerMode === "until") {
    const targetMs = Date.parse(input.expiresAt ?? "");
    if (Number.isNaN(targetMs) || targetMs <= nowMs) {
      throw new Error("End time must be in the future.");
    }
    const mins = Math.max(1, Math.round((targetMs - nowMs) / 60_000));
    return { expiresAt: new Date(targetMs).toISOString(), durationMinutes: mins };
  }
  const mins = input.durationMinutes ?? 60;
  return {
    expiresAt: new Date(nowMs + mins * 60_000).toISOString(),
    durationMinutes: mins
  };
}

/** Returns currently live floating-bar announcements visible to this user. */
export async function listActiveAnnouncementsForContext(options: {
  role: string;
  tenantId?: string;
}): Promise<SiteAnnouncement[]> {
  const nowMs = Date.now();
  const isSuperAdmin = options.role === "super_admin";
  const tenantId = !isSuperAdmin && options.tenantId ? options.tenantId : null;

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const queries = [
      supabase
        .from("site_announcements")
        .select("*")
        .eq("scope", "platform")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(10)
    ];
    if (tenantId) {
      queries.push(
        supabase
          .from("site_announcements")
          .select("*")
          .eq("scope", "tenant")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("updated_at", { ascending: false })
          .limit(10)
      );
    }

    const results = await Promise.all(queries);
    const missing = results.some((r) => r.error && isMissingAnnouncementsTable(r.error.message));
    if (!missing) {
      const combined: SiteAnnouncement[] = [];
      for (const res of results) {
        if (res.error) {
          throw new Error(`Failed to load announcements: ${res.error.message}`);
        }
        for (const row of res.data ?? []) {
          const parsed = mapRow(row as Record<string, unknown>);
          if (isSiteAnnouncementLive(parsed, nowMs)) {
            combined.push(parsed);
          }
        }
      }
      return sortActivePriority(combined);
    }
  }

  const live = memoryStore.filter((item) => {
    if (!isSiteAnnouncementLive(item, nowMs)) return false;
    if (item.scope === "platform") return true;
    return tenantId != null && item.tenantId === tenantId;
  });
  return sortActivePriority(live);
}

/** Returns all announcements (active, expired, stopped) for the management page. */
export async function listAnnouncementsForScope(
  scope: AnnouncementScope,
  tenantId?: string
): Promise<SiteAnnouncement[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    let query = supabase
      .from("site_announcements")
      .select("*")
      .eq("scope", scope)
      .order("created_at", { ascending: false })
      .limit(50);
    if (scope === "tenant") {
      if (!tenantId) return [];
      query = query.eq("tenant_id", tenantId);
    }
    const { data, error } = await query;
    if (!error) {
      return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
    }
    if (!isMissingAnnouncementsTable(error.message)) {
      throw new Error(`Failed to load announcements: ${error.message}`);
    }
  }

  return memoryStore
    .filter((item) => item.scope === scope && (scope === "platform" || item.tenantId === tenantId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createSiteAnnouncement(
  actor: {
    userId: string;
    fullName?: string;
    email?: string;
    scope: AnnouncementScope;
    tenantId?: string;
  },
  rawInput: unknown
): Promise<SiteAnnouncement> {
  const input = createSiteAnnouncementSchema.parse(rawInput);
  if (actor.scope === "tenant" && !actor.tenantId) {
    throw new Error("Company tenant context is required.");
  }
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const { expiresAt, durationMinutes } = resolveExpiryFromCreate(input, nowMs);
  const createdByName = actor.fullName?.trim() || actor.email?.trim() || undefined;
  const tenantId = actor.scope === "tenant" ? actor.tenantId! : null;

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    if (input.replaceActive) {
      let deactivate = supabase
        .from("site_announcements")
        .update({ is_active: false, updated_at: nowIso })
        .eq("scope", actor.scope)
        .eq("is_active", true);
      if (actor.scope === "tenant" && tenantId) {
        deactivate = deactivate.eq("tenant_id", tenantId);
      }
      const { error: deactErr } = await deactivate;
      if (deactErr && !isMissingAnnouncementsTable(deactErr.message)) {
        throw new Error(`Failed to replace active announcement: ${deactErr.message}`);
      }
    }

    const { data, error } = await supabase
      .from("site_announcements")
      .insert({
        scope: actor.scope,
        tenant_id: tenantId,
        title: input.title?.trim() || null,
        message: input.message.trim(),
        tone: input.tone,
        is_active: true,
        dismissible: input.dismissible,
        starts_at: nowIso,
        expires_at: expiresAt,
        duration_minutes: durationMinutes,
        created_by: actor.userId,
        created_by_name: createdByName ?? null,
        created_at: nowIso,
        updated_at: nowIso
      })
      .select("*")
      .single();

    if (!error && data) {
      return mapRow(data as Record<string, unknown>);
    }
    if (error && !isMissingAnnouncementsTable(error.message)) {
      throw new Error(`Failed to create announcement: ${error.message}`);
    }
  }

  if (input.replaceActive) {
    for (const item of memoryStore) {
      if (
        item.scope === actor.scope &&
        (actor.scope === "platform" || item.tenantId === tenantId) &&
        item.isActive
      ) {
        item.isActive = false;
        item.updatedAt = nowIso;
      }
    }
  }

  const created = siteAnnouncementSchema.parse({
    id: randomUUID(),
    scope: actor.scope,
    tenantId,
    title: input.title?.trim() || undefined,
    message: input.message.trim(),
    tone: input.tone,
    isActive: true,
    dismissible: input.dismissible,
    startsAt: nowIso,
    expiresAt,
    durationMinutes,
    createdBy: actor.userId,
    createdByName,
    createdAt: nowIso,
    updatedAt: nowIso
  });
  memoryStore.unshift(created);
  return created;
}

export async function updateSiteAnnouncement(
  actor: {
    scope: AnnouncementScope;
    tenantId?: string;
  },
  id: string,
  rawInput: unknown
): Promise<SiteAnnouncement> {
  const input: UpdateSiteAnnouncementInput = updateSiteAnnouncementSchema.parse(rawInput);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    let fetchQuery = supabase
      .from("site_announcements")
      .select("*")
      .eq("id", id)
      .eq("scope", actor.scope);
    if (actor.scope === "tenant") {
      if (!actor.tenantId) throw new Error("Announcement not found");
      fetchQuery = fetchQuery.eq("tenant_id", actor.tenantId);
    }
    const { data: existingRow, error: fetchErr } = await fetchQuery.maybeSingle();
    if (!fetchErr) {
      if (!existingRow) {
        throw new Error("Announcement not found");
      }
      const current = mapRow(existingRow as Record<string, unknown>);
      const patch = buildUpdatePatch(current, input, nowMs, nowIso);
      const { data: updated, error: updateErr } = await supabase
        .from("site_announcements")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (updateErr) {
        throw new Error(`Failed to update announcement: ${updateErr.message}`);
      }
      return mapRow(updated as Record<string, unknown>);
    }
    if (!isMissingAnnouncementsTable(fetchErr.message)) {
      throw new Error(`Failed to load announcement: ${fetchErr.message}`);
    }
  }

  const idx = memoryStore.findIndex(
    (item) =>
      item.id === id &&
      item.scope === actor.scope &&
      (actor.scope === "platform" || item.tenantId === actor.tenantId)
  );
  if (idx === -1) {
    throw new Error("Announcement not found");
  }
  const current = memoryStore[idx]!;
  const patch = buildUpdatePatch(current, input, nowMs, nowIso);
  const next = siteAnnouncementSchema.parse({
    ...current,
    title: patch.title !== undefined ? (patch.title ?? undefined) : current.title,
    message: patch.message !== undefined ? patch.message : current.message,
    tone: patch.tone !== undefined ? patch.tone : current.tone,
    isActive: patch.is_active !== undefined ? patch.is_active : current.isActive,
    dismissible: patch.dismissible !== undefined ? patch.dismissible : current.dismissible,
    expiresAt: patch.expires_at !== undefined ? patch.expires_at : current.expiresAt,
    durationMinutes:
      patch.duration_minutes !== undefined ? patch.duration_minutes : current.durationMinutes,
    updatedAt: nowIso
  });
  memoryStore[idx] = next;
  return next;
}

function buildUpdatePatch(
  current: SiteAnnouncement,
  input: UpdateSiteAnnouncementInput,
  nowMs: number,
  nowIso: string
): Record<string, unknown> {
  const patch: Record<string, unknown> = { updated_at: nowIso };
  if (input.title !== undefined) {
    patch.title = input.title ? input.title.trim() : null;
  }
  if (input.message !== undefined) {
    patch.message = input.message.trim();
  }
  if (input.tone !== undefined) {
    patch.tone = input.tone;
  }
  if (input.dismissible !== undefined) {
    patch.dismissible = input.dismissible;
  }
  if (input.isActive !== undefined) {
    patch.is_active = input.isActive;
  }

  if (input.extendMinutes != null) {
    const baseMs = current.expiresAt ? Math.max(nowMs, Date.parse(current.expiresAt) || nowMs) : nowMs;
    patch.expires_at = new Date(baseMs + input.extendMinutes * 60_000).toISOString();
    patch.duration_minutes = (current.durationMinutes ?? 0) + input.extendMinutes;
    patch.is_active = true;
  } else if (input.timerMode === "none") {
    patch.expires_at = null;
    patch.duration_minutes = null;
  } else if (input.timerMode === "duration" && input.durationMinutes != null) {
    patch.expires_at = new Date(nowMs + input.durationMinutes * 60_000).toISOString();
    patch.duration_minutes = input.durationMinutes;
  } else if (input.timerMode === "until" && input.expiresAt) {
    const targetMs = Date.parse(input.expiresAt);
    if (Number.isNaN(targetMs) || targetMs <= nowMs) {
      throw new Error("End time must be in the future.");
    }
    patch.expires_at = new Date(targetMs).toISOString();
    patch.duration_minutes = Math.max(1, Math.round((targetMs - nowMs) / 60_000));
  } else if (input.expiresAt !== undefined) {
    if (input.expiresAt === null) {
      patch.expires_at = null;
      patch.duration_minutes = null;
    } else {
      const targetMs = Date.parse(input.expiresAt);
      if (Number.isNaN(targetMs) || targetMs <= nowMs) {
        throw new Error("End time must be in the future.");
      }
      patch.expires_at = new Date(targetMs).toISOString();
    }
  }

  return patch;
}

export async function deleteSiteAnnouncement(
  actor: {
    scope: AnnouncementScope;
    tenantId?: string;
  },
  id: string
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    let del = supabase
      .from("site_announcements")
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("scope", actor.scope);
    if (actor.scope === "tenant") {
      if (!actor.tenantId) throw new Error("Announcement not found");
      del = del.eq("tenant_id", actor.tenantId);
    }
    const { error, count } = await del;
    if (!error) {
      if (count === 0) {
        throw new Error("Announcement not found");
      }
      return;
    }
    if (!isMissingAnnouncementsTable(error.message)) {
      throw new Error(`Failed to delete announcement: ${error.message}`);
    }
  }

  const idx = memoryStore.findIndex(
    (item) =>
      item.id === id &&
      item.scope === actor.scope &&
      (actor.scope === "platform" || item.tenantId === actor.tenantId)
  );
  if (idx === -1) {
    throw new Error("Announcement not found");
  }
  memoryStore.splice(idx, 1);
}

/** Test helper to clear in-memory announcements between unit tests. */
export function _resetSiteAnnouncementsMemory(): void {
  memoryStore.length = 0;
}
