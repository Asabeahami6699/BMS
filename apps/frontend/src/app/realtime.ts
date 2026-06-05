import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return null;
  }

  if (!client) {
    client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
  }

  return client;
}

type SubscribeInput = {
  tenantId: string;
  tables: string[];
  onChange: () => void;
};

type ChannelEntry = {
  channel: RealtimeChannel;
  listeners: Set<() => void>;
  subscribed: boolean;
};

/** One Supabase channel per tenant+table; multiple stores can share it. */
const channelRegistry = new Map<string, ChannelEntry>();

function channelKey(tenantId: string, table: string): string {
  return `${tenantId}:${table}`;
}

function dispatchListeners(entry: ChannelEntry): void {
  for (const listener of entry.listeners) {
    listener();
  }
}

function ensureChannelSubscribed(
  supabase: SupabaseClient,
  tenantId: string,
  table: string,
  entry: ChannelEntry
): void {
  if (entry.subscribed) {
    return;
  }
  entry.channel.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table,
      filter: `tenant_id=eq.${tenantId}`
    },
    () => dispatchListeners(entry)
  );
  entry.channel.subscribe();
  entry.subscribed = true;
}

export function subscribeToTenantRealtime(input: SubscribeInput): () => void {
  const supabase = getClient();
  if (!supabase) {
    return () => {};
  }

  const releases: Array<() => void> = [];

  for (const table of input.tables) {
    const key = channelKey(input.tenantId, table);
    let entry = channelRegistry.get(key);

    if (!entry) {
      entry = {
        channel: supabase.channel(`tenant-${input.tenantId}-${table}`),
        listeners: new Set(),
        subscribed: false
      };
      channelRegistry.set(key, entry);
    }

    const listener = input.onChange;
    entry.listeners.add(listener);
    ensureChannelSubscribed(supabase, input.tenantId, table, entry);

    releases.push(() => {
      const current = channelRegistry.get(key);
      if (!current) {
        return;
      }
      current.listeners.delete(listener);
      if (current.listeners.size > 0) {
        return;
      }
      void supabase.removeChannel(current.channel);
      channelRegistry.delete(key);
    });
  }

  return () => {
    for (const release of releases) {
      release();
    }
  };
}
