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