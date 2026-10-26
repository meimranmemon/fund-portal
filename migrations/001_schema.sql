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