-- Persist tenant-configurable staff/agent commission policy (including cycle-share formula: total / cycle_days * multiplier).
CREATE TABLE IF NOT EXISTS public.commission_policies (
  tenant_id TEXT PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'GHS',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  field_agent_commission_method TEXT NOT NULL DEFAULT 'cycle_share'
    CHECK (field_agent_commission_method IN ('cycle_share', 'percentage')),
  field_agent_cycle_days NUMERIC(8,2) NOT NULL DEFAULT 31 CHECK (field_agent_cycle_days >= 1),
  field_agent_cycle_multiplier NUMERIC(8,4) NOT NULL DEFAULT 0.5 CHECK (field_agent_cycle_multiplier >= 0),
  field_agent_commission_percent NUMERIC(8,4) NOT NULL DEFAULT 2.5,
  coordinator_commission_percent NUMERIC(8,4) NOT NULL DEFAULT 1,
  basis TEXT NOT NULL DEFAULT 'gross_collections'
    CHECK (basis IN ('gross_collections', 'net_collections')),
  bonus_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.commission_policies ENABLE ROW LEVEL SECURITY;
