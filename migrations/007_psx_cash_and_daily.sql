CREATE TABLE IF NOT EXISTS psx_cash_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL,
  type TEXT NOT NULL,             -- 'deposit' | 'withdrawal' | 'buy' | 'sell'
  amount NUMERIC NOT NULL,        -- positive = cash in, negative = cash out
  related_lot_id UUID,
  trade_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_owner ON psx_cash_ledger(owner_user_id, trade_date);

-- Daily snapshot of the WHOLE PSX portfolio (invested + unrealized + realized-to-date),
-- so Daily/Weekly/Monthly/Yearly reports can cover total performance, not just realized trades.
CREATE TABLE IF NOT EXISTS psx_daily_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL,
  trading_date DATE NOT NULL,
  invested_total NUMERIC,
  current_value_total NUMERIC,
  unrealized_total NUMERIC,
  realized_cumulative NUMERIC,
  cash_balance NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(owner_user_id, trading_date)
);