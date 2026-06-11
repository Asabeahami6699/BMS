-- Agent-to-agent ecash transfers between company bank accounts (e.g. Ecobank daily limit workaround)
CREATE TABLE IF NOT EXISTS public.back_office_agent_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id uuid NOT NULL REFERENCES public.branches (id) ON DELETE RESTRICT,
  session_id uuid REFERENCES public.back_office_day_sessions (id) ON DELETE SET NULL,
  from_bank_product_id uuid NOT NULL REFERENCES public.tenant_bank_products (id) ON DELETE RESTRICT,
  to_bank_product_id uuid NOT NULL REFERENCES public.tenant_bank_products (id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  notes text,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT back_office_agent_transfers_distinct_accounts CHECK (from_bank_product_id <> to_bank_product_id)
);

CREATE INDEX IF NOT EXISTS idx_back_office_agent_transfers_tenant
  ON public.back_office_agent_transfers (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_back_office_agent_transfers_branch
  ON public.back_office_agent_transfers (tenant_id, branch_id, created_at DESC);
