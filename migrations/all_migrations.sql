-- Funds: each investor (req.user.id) owns their own funds privately
CREATE TABLE IF NOT EXISTS funds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  benchmark TEXT DEFAULT 'KSE-100',
  total_investment_amount NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id UUID NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  ticker TEXT,
  weight_pct NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL,
  trading_date DATE NOT NULL,
  close_price NUMERIC,
  previous_close NUMERIC,
  source TEXT DEFAULT 'PSX',
  retrieved_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(ticker, trading_date)
);

CREATE TABLE IF NOT EXISTS daily_gain_loss (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL,
  fund_id UUID NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  holding_id UUID NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  trading_date DATE NOT NULL,
  allocated_amount NUMERIC,
  price_change_pct NUMERIC,
  gain_loss_amount NUMERIC,
  data_status TEXT DEFAULT 'OK',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(holding_id, trading_date)
);

CREATE TABLE IF NOT EXISTS fund_daily_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL,
  fund_id UUID NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  trading_date DATE NOT NULL,
  total_gain_loss_amount NUMERIC,
  total_return_pct NUMERIC,
  market_contribution_pct NUMERIC,
  validation_status TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(fund_id, trading_date)
);

CREATE TABLE IF NOT EXISTS news_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fetched_at TIMESTAMPTZ DEFAULT now(),
  source_site TEXT NOT NULL,
  headline TEXT NOT NULL,
  link TEXT,
  tags JSONB
);

CREATE INDEX IF NOT EXISTS idx_holdings_fund ON holdings(fund_id);
CREATE INDEX IF NOT EXISTS idx_dgl_fund_date ON daily_gain_loss(fund_id, trading_date);
CREATE INDEX IF NOT EXISTS idx_fds_fund_date ON fund_daily_summary(fund_id, trading_date);
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
-- PSX Direct Portfolio (separate from AMC funds): individual share buy/sell tracking
-- with PSX brokerage slabs, government tax, and CGT.

CREATE TABLE IF NOT EXISTS psx_settings (
  owner_user_id TEXT PRIMARY KEY,
  govt_tax_pct NUMERIC NOT NULL DEFAULT 0.15,   -- editable, applied on trade value (buy & sell)
  cgt_pct NUMERIC NOT NULL DEFAULT 15,          -- editable, applied on realized gain at sale
  -- Brokerage slab, editable too (PSX-prescribed default):
  --   trade value per share <= slab1_max  -> slab1_fixed_paisa per share
  --   trade value per share  > slab1_max  -> slab2_pct of trade value
  slab1_max NUMERIC NOT NULL DEFAULT 20,
  slab1_paisa NUMERIC NOT NULL DEFAULT 0.03,
  slab2_pct NUMERIC NOT NULL DEFAULT 0.15,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS psx_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL,
  company TEXT NOT NULL,
  ticker TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  buy_price NUMERIC NOT NULL,
  buy_date DATE NOT NULL,
  buy_commission NUMERIC NOT NULL,      -- brokerage + govt tax paid at purchase
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'sold'
  sell_price NUMERIC,
  sell_date DATE,
  sell_commission NUMERIC,              -- brokerage + govt tax paid at sale
  cgt_amount NUMERIC,                   -- capital gains tax charged on realized gain
  realized_pl NUMERIC,                  -- net P/L after all costs, once sold
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_psx_lots_owner_status ON psx_lots(owner_user_id, status);
CREATE INDEX IF NOT EXISTS idx_psx_lots_ticker ON psx_lots(ticker);

-- Live/day-end price + indicator snapshot per ticker (shared across all investors - public market data)
CREATE TABLE IF NOT EXISTS psx_indicators (
  ticker TEXT PRIMARY KEY,
  as_of TEXT,
  current_price NUMERIC,
  previous_close NUMERIC,
  sma50 NUMERIC, sma100 NUMERIC, sma200 NUMERIC,
  rsi14 NUMERIC,
  bb_upper NUMERIC, bb_mid NUMERIC, bb_lower NUMERIC,
  signal TEXT,            -- 'BUY' | 'SELL' | 'HOLD' | 'INSUFFICIENT HISTORY'
  signal_reasons JSONB,
  history_days INTEGER,
  computed_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE price_history ADD COLUMN IF NOT EXISTS day_high NUMERIC;
ALTER TABLE price_history ADD COLUMN IF NOT EXISTS day_low NUMERIC;
CREATE TABLE IF NOT EXISTS index_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_label TEXT NOT NULL,
  trading_date DATE NOT NULL,
  return_pct NUMERIC,
  recorded_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(index_label, trading_date)
);
ALTER TABLE price_history ADD COLUMN IF NOT EXISTS volume NUMERIC;
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
ALTER TABLE fund_daily_summary ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'live';

-- Add sort_order for drag & drop company positioning
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
