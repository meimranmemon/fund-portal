-- Live price details stored with each daily row
ALTER TABLE daily_gain_loss ADD COLUMN IF NOT EXISTS current_price NUMERIC;
ALTER TABLE daily_gain_loss ADD COLUMN IF NOT EXISTS previous_close NUMERIC;
ALTER TABLE daily_gain_loss ADD COLUMN IF NOT EXISTS quote_asof TEXT;

-- Investment amount snapshot per day, so history shows investment changes over time
ALTER TABLE fund_daily_summary ADD COLUMN IF NOT EXISTS investment_amount NUMERIC;

-- Intraday snapshots: one row per refresh where the fund's P/L changed (drives the live chart)
CREATE TABLE IF NOT EXISTS fund_ticks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL,
  fund_id UUID NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  trading_date DATE NOT NULL,
  ts TIMESTAMPTZ DEFAULT now(),
  total_gain_loss NUMERIC,
  total_return_pct NUMERIC,
  benchmark_return_pct NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_ticks_fund_ts ON fund_ticks(fund_id, ts);

-- News: real publish date/time + de-duplication
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
DELETE FROM news_items WHERE published_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_news_source_headline ON news_items(source_site, headline);
CREATE INDEX IF NOT EXISTS idx_news_pub ON news_items(published_at DESC);