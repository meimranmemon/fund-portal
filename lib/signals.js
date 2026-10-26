// Signal engine: standard, widely used indicators combined into one transparent score.
// Every factor and its score is shown to the investor. NOTHING here is a guarantee - no
// indicator set is 100% accurate - so the engine also BACKTESTS itself on the stock's own
// 3-year history and reports how often the rules were actually right (vs. a coin-flip base rate).
import { swingStructure } from "./indicators.js";

export function ema(values, period) {
  const k = 2 / (period + 1); const out = []; let prev = null;
  for (let i = 0; i < values.length; i++) { prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k); out.push(prev); }
  return out;
}

export function buildSeries(closes, volumes) {
  const n = closes.length;
  const ps = [0]; for (const c of closes) ps.push(ps[ps.length - 1] + c);
  const smaAt = (i, p) => (i >= 0 && i + 1 >= p ? (ps[i + 1] - ps[i + 1 - p]) / p : null);
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const macd = e12.map((v, i) => v - e26[i]);
  const sig = ema(macd, 9);
  const obv = [0];
  for (let i = 1; i < n; i++) obv.push(obv[i - 1] + (closes[i] > closes[i - 1] ? volumes[i] : closes[i] < closes[i - 1] ? -volumes[i] : 0));
  return { n, closes, volumes, smaAt, macd, sig, obv };
}

function rsiAt(S, i, period = 14) {
  if (i < period) return null;
  let g = 0, l = 0;
  for (let k = i - period + 1; k <= i; k++) { const d = S.closes[k] - S.closes[k - 1]; if (d >= 0) g += d; else l -= d; }
  if (l === 0) return 100;
  return 100 - 100 / (1 + g / l);
}

// Technical factors at bar i (uses only data up to i, so it is safe to backtest).
export function technicalFactors(S, i) {
  const { closes, volumes } = S; const price = closes[i]; const out = [];
  const add = (name, score, text) => out.push({ name, score, text });

  const r = rsiAt(S, i);
  if (r != null) add("RSI(14)", r < 30 ? 1 : r > 70 ? -1 : 0, r < 30 ? `RSI ${r.toFixed(1)} - oversold` : r > 70 ? `RSI ${r.toFixed(1)} - overbought` : `RSI ${r.toFixed(1)} - neutral`);

  if (i >= 30) {
    const bull = S.macd[i] > S.sig[i], was = S.macd[i - 3] > S.sig[i - 3];
    if (bull && !was) add("MACD", 1, "Fresh bullish MACD crossover (last 3 bars)");
    else if (!bull && was) add("MACD", -1, "Fresh bearish MACD crossover (last 3 bars)");
    else add("MACD", bull ? 0.5 : -0.5, bull ? "MACD above signal line - bullish momentum" : "MACD below signal line - bearish momentum");
  }

  const s20 = S.smaAt(i, 20), s50 = S.smaAt(i, 50), s200 = S.smaAt(i, 200);
  if (s50 != null) add("SMA 50", price > s50 ? 0.5 : -0.5, `Price ${price > s50 ? "above" : "below"} SMA50 (${s50.toFixed(2)})`);
  if (s200 != null) add("SMA 200", price > s200 ? 0.5 : -0.5, `Price ${price > s200 ? "above" : "below"} SMA200 (${s200.toFixed(2)})`);
  if (s50 != null && s200 != null) {
    const now = s50 > s200, p50 = S.smaAt(i - 10, 50), p200 = S.smaAt(i - 10, 200);
    const was = p50 != null && p200 != null ? p50 > p200 : now;
    if (now && !was) add("MA cross", 1, "Golden cross: SMA50 crossed above SMA200 (last 10 bars)");
    else if (!now && was) add("MA cross", -1, "Death cross: SMA50 crossed below SMA200 (last 10 bars)");
    else add("MA cross", now ? 0.3 : -0.3, `SMA50 ${now ? "above" : "below"} SMA200 - ${now ? "bullish" : "bearish"} long-term structure`);
  }

  if (i >= 19 && s20 != null) {
    let v = 0; for (let k = i - 19; k <= i; k++) v += (closes[k] - s20) ** 2;
    const sd = Math.sqrt(v / 20), up = s20 + 2 * sd, lo = s20 - 2 * sd;
    if (price <= lo) add("Bollinger", 0.7, "Price at/below lower Bollinger Band - stretched down");
    else if (price >= up) add("Bollinger", -0.7, "Price at/above upper Bollinger Band - stretched up");
    else add("Bollinger", 0, "Price inside Bollinger Bands");
  }

  if (i >= 21) {
    let sv = 0; for (let k = i - 20; k < i; k++) sv += volumes[k];
    const avg = sv / 20;
    if (avg > 0) {
      const ratio = volumes[i] / avg, chg = closes[i] - closes[i - 1];
      if (ratio >= 1.5 && chg > 0) add("Volume", 0.8, `High volume (${ratio.toFixed(1)}x average) on an up day - buying pressure`);
      else if (ratio >= 1.5 && chg < 0) add("Volume", -0.8, `High volume (${ratio.toFixed(1)}x average) on a down day - selling pressure`);
      else add("Volume", 0, `Volume ${ratio.toFixed(1)}x average - normal`);
    }
    const d = S.obv[i] - S.obv[i - 20];
    add("OBV", d > 0 ? 0.3 : d < 0 ? -0.3 : 0, `On-Balance Volume ${d > 0 ? "rising (accumulation)" : d < 0 ? "falling (distribution)" : "flat"} over 20 bars`);
  }

  if (i >= 20) {
    let mx = -Infinity, mn = Infinity;
    for (let k = i - 20; k < i; k++) { if (closes[k] > mx) mx = closes[k]; if (closes[k] < mn) mn = closes[k]; }
    if (price > mx) add("Breakout", 1, `Breakout: closed above the 20-bar high (${mx.toFixed(2)})`);
    else if (price < mn) add("Breakdown", -1, `Breakdown: closed below the 20-bar low (${mn.toFixed(2)})`);
  }

  if (i >= 12) {
    const w = closes.slice(Math.max(0, i - 59), i + 1);
    const sw = swingStructure(w, w);
    if (sw.structure && sw.structure.includes("uptrend")) add("Structure", 0.5, "Higher highs & higher lows (HH/HL uptrend)");
    else if (sw.structure && sw.structure.includes("downtrend")) add("Structure", -0.5, "Lower highs & lower lows (LH/LL downtrend)");
  }
  return out;
}

export function classify(score) {
  return score >= 3 ? "STRONG BUY" : score >= 1.5 ? "BUY" : score <= -3 ? "STRONG SELL" : score <= -1.5 ? "SELL" : "HOLD";
}

// Re-runs the technical rules at every past bar of THIS stock and measures what happened
// 10 trading days later - so the investor sees real hit-rates, not a claimed accuracy.
export function backtestSignals(closes, volumes, horizon = 10, lookback = 750) {
  const S = buildSeries(closes, volumes), n = closes.length;
  const start = Math.max(210, n - lookback);
  const buy = { n: 0, hit: 0, sum: 0 }, sell = { n: 0, hit: 0, sum: 0 };
  let up = 0, total = 0, skip = 0;
  for (let i = start; i < n - horizon; i++) {
    const fwd = (closes[i + horizon] - closes[i]) / closes[i] * 100;
    total++; if (fwd > 0) up++;
    if (skip > 0) { skip--; continue; }
    const score = technicalFactors(S, i).reduce((a, f) => a + f.score, 0);
    if (score >= 1.5) { buy.n++; if (fwd > 0) buy.hit++; buy.sum += fwd; skip = 5; }
    else if (score <= -1.5) { sell.n++; if (fwd < 0) sell.hit++; sell.sum += fwd; skip = 5; }
  }
  const pct = (a, b) => (b ? (a / b) * 100 : null);
  return {
    horizon_days: horizon, bars_tested: total,
    buy: { n: buy.n, hit_pct: pct(buy.hit, buy.n), avg_move_pct: buy.n ? buy.sum / buy.n : null },
    sell: { n: sell.n, hit_pct: pct(sell.hit, sell.n), avg_move_pct: sell.n ? sell.sum / sell.n : null },
    base_up_pct: pct(up, total),
  };
}

const POS = ["profit", "record", "dividend", "surge", "rally", "gain", "jump", "growth", "upgrade", "boost", "approved", "higher", "rise", "soar", "beat", "expansion", "discovery", "bonus"];
const NEG = ["loss", "decline", "plunge", "slump", "default", "penalty", "fine", "downgrade", "fraud", "probe", "shutdown", "fall", "drop", "crash", "lawsuit", "outage", "delay", "halt", "suspend"];

// Company-specific headlines from the last days (keyword sentiment - rough, low weight).
export function matchNews(rows, ticker, company) {
  const norm = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/\s+/g, " ").trim();
  const name = norm(String(company || "").replace(/\(.*?\)/g, "").replace(/\b(the|limited|ltd|company|co\.?|corporation|corp|pvt|private)\b/gi, ""));
  const tickRe = ticker && ticker.length >= 3 ? new RegExp("\\b" + ticker + "\\b", "i") : null;
  const out = [];
  for (const r of rows) {
    if (String(r.source_site).startsWith("PSX Announcement")) continue;
    const h = r.headline;
    if ((name.length >= 6 && norm(h).includes(name)) || (tickRe && tickRe.test(h))) {
      let s = 0;
      for (const w of POS) if (new RegExp("\\b" + w, "i").test(h)) s++;
      for (const w of NEG) if (new RegExp("\\b" + w, "i").test(h)) s--;
      out.push({ headline: h, source: r.source_site, published_at: r.published_at, sentiment: Math.sign(s) });
    }
  }
  return out.slice(0, 5);
}

export function buildLiveSignal(o) {
  const n = o.closes.length;
  if (n < 30) {
    return { signal: "INSUFFICIENT HISTORY", score: 0, factors: [], agreement: null, reasons: [`Only ${n} trading day(s) of history available`],
      backtest: null, fundamentals: o.fundamentals || null, news: [] };
  }
  const S = buildSeries(o.closes, o.volumes);
  const factors = technicalFactors(S, n - 1);

  if (o.pivots) {
    if (o.price > o.pivots.r1) factors.push({ name: "Pivot", score: 0.3, text: `Above Resistance 1 (${o.pivots.r1.toFixed(2)})` });
    else if (o.price < o.pivots.s1) factors.push({ name: "Pivot", score: -0.3, text: `Below Support 1 (${o.pivots.s1.toFixed(2)})` });
  }

  const fu = o.fundamentals;
  if (fu) {
    if (fu.eps_growth_annual != null) {
      const g = fu.eps_growth_annual;
      factors.push({ name: "Results (annual)", score: g >= 10 ? 0.5 : g <= -10 ? -0.5 : 0,
        text: `Annual EPS ${fu.eps_annual[0]} vs ${fu.eps_annual[1]} last year (${g >= 0 ? "+" : ""}${g.toFixed(1)}%)` });
    }
    if (fu.eps_q_yoy_growth != null) {
      const g = fu.eps_q_yoy_growth;
      factors.push({ name: "Results (quarter)", score: g >= 10 ? 0.5 : g <= -10 ? -0.5 : 0,
        text: `${fu.q_label} EPS vs same quarter last year (${g >= 0 ? "+" : ""}${g.toFixed(1)}%)` });
    }
  }

  const news = matchNews(o.newsRows || [], o.ticker, o.company);
  if (news.length) {
    const net = news.reduce((a, b) => a + b.sentiment, 0);
    factors.push({ name: "News", score: Math.max(-0.5, Math.min(0.5, net * 0.25)),
      text: `${news.length} company headline(s) in last 5 days - keyword sentiment ${net > 0 ? "positive" : net < 0 ? "negative" : "mixed/neutral"}` });
  }

  const score = factors.reduce((a, f) => a + f.score, 0);
  const bull = factors.filter(f => f.score > 0).length, bear = factors.filter(f => f.score < 0).length;
  return {
    signal: classify(score), score, factors,
    agreement: { bull, bear, neutral: factors.length - bull - bear, total: factors.length },
    reasons: factors.filter(f => f.score !== 0).map(f => f.text),
    backtest: n >= 260 ? backtestSignals(o.closes, o.volumes) : null,
    fundamentals: fu || null, news,
  };
}