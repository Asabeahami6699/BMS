-- Persist teller call-over checkmarks and confirmation timestamp on branch float sessions
-- so completed call-over records remain marked permanently after closing the till.

ALTER TABLE branch_float_sessions
  ADD COLUMN IF NOT EXISTS callover_checked_tx_ids JSONB,
  ADD COLUMN IF NOT EXISTS callover_confirmed_at TIMESTAMPTZ;
