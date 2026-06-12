-- Susu daily closing balance inputs (branch-level cash reconciliation for susu-only tenants)
CREATE TABLE IF NOT EXISTS public.susu_daily_closing_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  business_date date NOT NULL,
  initial_cash numeric(14, 2) NOT NULL DEFAULT 0,
  susu_expenses numeric(14, 2) NOT NULL DEFAULT 0,
  notes text,
  recorded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, business_date)
);

CREATE INDEX IF NOT EXISTS idx_susu_daily_closing_tenant_branch
  ON public.susu_daily_closing_records (tenant_id, branch_id, business_date DESC);

COMMENT ON TABLE public.susu_daily_closing_records IS
  'Editable opening cash and susu expenses for daily branch closing calculation.';

-- Field agent daily withdrawal fulfillment tracking (coordinator-approved agent channel withdrawals)
CREATE TABLE IF NOT EXISTS public.field_agent_withdrawal_fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text,
  field_agent_id text NOT NULL,
  business_date date NOT NULL,
  total_requested numeric(14, 2) NOT NULL DEFAULT 0,
  total_approved numeric(14, 2) NOT NULL DEFAULT 0,
  total_fulfilled numeric(14, 2) NOT NULL DEFAULT 0,
  customer_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, field_agent_id, business_date)
);

CREATE INDEX IF NOT EXISTS idx_field_agent_withdrawal_fulfillment_tenant
  ON public.field_agent_withdrawal_fulfillments (tenant_id, business_date DESC);

CREATE TABLE IF NOT EXISTS public.field_agent_withdrawal_fulfillment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id uuid NOT NULL REFERENCES public.field_agent_withdrawal_fulfillments (id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  customer_id text NOT NULL,
  disclosure_id text,
  transaction_id text,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  fulfilled_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_field_agent_withdrawal_fulfillment_lines_parent
  ON public.field_agent_withdrawal_fulfillment_lines (fulfillment_id);

COMMENT ON TABLE public.field_agent_withdrawal_fulfillments IS
  'Daily rollup of field-agent channel customer withdrawals after coordinator approval.';
