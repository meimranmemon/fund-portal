import { db } from "hatchable";
import { getLatestAndPrevious } from "../../lib/engine.js";
import { getPsxToken, getEod, mergeLive, prevFromEod } from "../../lib/psxApi.js";
import { buildLiveSignal } from "../../lib/signals.js";
import { sma, rsi, bollingerBands, pivotPoints, buildSignal, volatilityPct, volumeTrend, swingStructure, suggestTakeProfit } from "../../lib/indicators.js";

export const access = "user";

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

export default async function (req, res) {
  const { rows: lots } = await db.query(
    "SELECT * FROM psx_lots WHERE owner_user_id=$1 ORDER BY buy_date DESC, created_at DESC", [req.user.id]);
  const active = lots.filter(l => l.status === "active");
  const sold = lots.filter(l => l.status === "sold");

  const tickers = [...new Set(active.map(l => l.ticker))];
  const quotes = new Map();
  for (let i = 0; i < tickers.length; i += 6) {
    await Promise.all(tickers.slice(i, i + 6).map(async t => quotes.set(t, await getLatestAndPrevious(t))));
  }

  const today = new Date().toISOString().slice(0, 10);

  // Real daily history (~5 years of closes + volumes) straight from PSX's official API, so
  // SMA 50/100/200, RSI, Bollinger Bands, volume trend work from day one. Falls back to the
  // history this app collected itself if PSX's API can't be reached.
  const psxToken = await getPsxToken();
  const eodByTicker = new Map();
  for (let i = 0; i < tickers.length; i += 4) {
    await Promise.all(tickers.slice(i, i + 4).map(async t => eodByTicker.set(t, psxToken ? await getEod(t, psxToken) : null)));
  }

  for (const [t, q] of quotes) {                       // true previous close from PSX's official history
    const e = eodByTicker.get(t);
    if (e && q.status === "OK") { const p = prevFromEod(e, q.date); if (p) q.previous = p; }
  }

  const phRows = [...quotes.entries()].filter(([, q]) => q.status === "OK");
  if (phRows.length) {
    await db.query(
      `INSERT INTO price_history (ticker, trading_date, close_price, previous_close, day_high, day_low, volume)
       SELECT * FROM unnest($1::text[], $2::date[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[])
       ON CONFLICT (ticker, trading_date) DO UPDATE SET close_price = EXCLUDED.close_price,
         previous_close = EXCLUDED.previous_close, day_high = EXCLUDED.day_high, day_low = EXCLUDED.day_low,
         volume = EXCLUDED.volume, retrieved_at = now()`,
      [phRows.map(([t]) => t), phRows.map(([, q]) => q.date || today), phRows.map(([, q]) => q.current),
       phRows.map(([, q]) => q.previous), phRows.map(([, q]) => q.dayHigh), phRows.map(([, q]) => q.dayLow),
       phRows.map(([, q]) => q.volume)]);
  }

  const { rows: histRows } = tickers.length
    ? await db.query(
        `SELECT ticker, trading_date, close_price, day_high, day_low, volume FROM price_history
         WHERE ticker = ANY($1::text[]) ORDER BY ticker, trading_date ASC`, [tickers])
    : { rows: [] };
  const histByTicker = new Map();
  for (const r of histRows) {
    if (!histByTicker.has(r.ticker)) histByTicker.set(r.ticker, []);
    histByTicker.get(r.ticker).push(r);
  }

  const { rows: newsRows } = active.length
    ? await db.query("SELECT headline, source_site, published_at FROM news_items WHERE published_at > now() - interval '5 days' ORDER BY published_at DESC LIMIT 400")
    : { rows: [] };

  function computeIndicators(ticker, q, company) {
    const hist = histByTicker.get(ticker) || [];
    const eod = eodByTicker.get(ticker);
    let closes, highs, lows, volumes, historySource;
    if (eod && eod.length > 1) {
      const series = mergeLive(eod, q.current, q.date, q.volume);
      closes = series.map(p => p.close);
      highs = closes; lows = closes;                 // PSX EOD has no daily high/low -> swing structure uses closes
      volumes = series.map(p => p.volume || 0);
      historySource = "PSX official daily history";
    } else {
      closes = hist.map(h => Number(h.close_price));
      highs = hist.map(h => h.day_high != null ? Number(h.day_high) : Number(h.close_price));
      lows = hist.map(h => h.day_low != null ? Number(h.day_low) : Number(h.close_price));
      volumes = hist.map(h => Number(h.volume) || 0);
      historySource = "collected by this app";
    }
    const price = q.current;
    const sma20 = sma(closes, 20), sma50 = sma(closes, 50), sma100 = sma(closes, 100), sma200 = sma(closes, 200);
    const rsiVal = rsi(closes, 14);
    const bb = bollingerBands(closes, 20, 2);
    const vol = volatilityPct(closes, 20);
    const volTrend = volumeTrend(volumes);
    const swing = swingStructure(highs, lows);

    const priorRow = [...hist].reverse().find(h => h.trading_date !== (q.date || today) && h.day_high != null);
    const pivots = priorRow
      ? pivotPoints(Number(priorRow.day_high), Number(priorRow.day_low), Number(priorRow.close_price))
      : (q.dayHigh != null && q.dayLow != null ? pivotPoints(q.dayHigh, q.dayLow, q.previous) : null);

    const sig = buildLiveSignal({ closes, volumes, price, pivots, fundamentals: q.fundamentals, newsRows, ticker, company });
    const takeProfit = suggestTakeProfit(price, pivots);

    return {
      day_high: q.dayHigh, day_low: q.dayLow, day_open: q.dayOpen, volume: q.volume,
      sma20, sma50, sma100, sma200, rsi14: rsiVal, bb_upper: bb.upper, bb_mid: bb.mid, bb_lower: bb.lower,
      pivots, volatility_pct: vol, volume_trend: volTrend.trend, volume_ratio: volTrend.ratio,
      swing_structure: swing.structure, take_profit: takeProfit,
      history_days: closes.length, history_source: historySource, signal: sig.signal, signal_reasons: sig.reasons,
      score: sig.score, signal_factors: sig.factors, agreement: sig.agreement, backtest: sig.backtest,
      fundamentals: sig.fundamentals, news_matches: sig.news,
    };
  }

  let investedTotal = 0, currentValueTotal = 0, unrealizedTotal = 0, priced = 0;
  const activeOut = active.map(l => {
    const q = quotes.get(l.ticker);
    const qty = Number(l.quantity), buyPrice = Number(l.buy_price), buyCost = Number(l.buy_commission);
    const invested = qty * buyPrice + buyCost;
    investedTotal += invested;
    let live = null, unrealizedPl = null, unrealizedPct = null, currentValue = null, dayChangePct = null, indicators = null;
    if (q && q.status === "OK") {
      live = q.current;
      currentValue = qty * live;
      unrealizedPl = currentValue - invested;
      unrealizedPct = invested > 0 ? (unrealizedPl / invested) * 100 : null;
      dayChangePct = q.previous ? ((q.current - q.previous) / q.previous) * 100 : null;
      currentValueTotal += currentValue; unrealizedTotal += unrealizedPl; priced++;
      indicators = computeIndicators(l.ticker, q, l.company);
    }
    return {
      id: l.id, company: l.company, ticker: l.ticker, quantity: qty, buy_price: buyPrice,
      buy_date: l.buy_date, buy_commission: buyCost, invested,
      live_price: live, day_change_pct: dayChangePct, quote_status: q ? q.status : "PSX DATA UNAVAILABLE",
      quote_asof: q ? q.asof : null, current_value: currentValue,
      unrealized_pl: unrealizedPl, unrealized_pct: unrealizedPct,
      holding_days: daysBetween(l.buy_date, today), notes: l.notes, indicators,
    };
  });

  let realizedTotal = 0;
  const soldOut = sold.map(l => {
    realizedTotal += Number(l.realized_pl) || 0;
    return {
      id: l.id, company: l.company, ticker: l.ticker, quantity: Number(l.quantity),
      buy_price: Number(l.buy_price), buy_date: l.buy_date, sell_price: Number(l.sell_price),
      sell_date: l.sell_date, buy_commission: Number(l.buy_commission), sell_commission: Number(l.sell_commission),
      cgt_amount: Number(l.cgt_amount), realized_pl: Number(l.realized_pl),
      holding_days: daysBetween(l.buy_date, l.sell_date),
    };
  });

  const { rows: cashRows } = await db.query(
    "SELECT COALESCE(SUM(amount),0) AS balance FROM psx_cash_ledger WHERE owner_user_id=$1", [req.user.id]);
  const cashBalance = Number(cashRows[0].balance);

  // Snapshot today's whole-portfolio numbers (one row/day, overwritten as the day progresses)
  // so the Daily/Weekly/Monthly/Yearly P/L report has real history to draw from.
  if (priced === active.length) {
    await db.query(
      `INSERT INTO psx_daily_summary (owner_user_id, trading_date, invested_total, current_value_total,
         unrealized_total, realized_cumulative, cash_balance)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (owner_user_id, trading_date) DO UPDATE SET invested_total=EXCLUDED.invested_total,
         current_value_total=EXCLUDED.current_value_total, unrealized_total=EXCLUDED.unrealized_total,
         realized_cumulative=EXCLUDED.realized_cumulative, cash_balance=EXCLUDED.cash_balance`,
      [req.user.id, today, investedTotal, currentValueTotal, unrealizedTotal, realizedTotal, cashBalance]);
  }

  res.json({
    server_time: new Date().toISOString(),
    active: activeOut, sold: soldOut,
    summary: {
      active_count: active.length, sold_count: sold.length,
      invested_total: investedTotal, current_value_total: priced === active.length ? currentValueTotal : null,
      unrealized_total: priced === active.length ? unrealizedTotal : null,
      priced_count: priced, realized_total: realizedTotal, cash_balance: cashBalance,
    },
  });
}