CREATE TABLE IF NOT EXISTS index_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_label TEXT NOT NULL,
  trading_date DATE NOT NULL,
  return_pct NUMERIC,
  recorded_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(index_label, trading_date)
);