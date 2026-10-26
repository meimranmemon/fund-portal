// Global reference rates (Oil, Gold, USD/PKR, Bitcoin) with full daily/weekly/monthly/FY/
// yearly breakdown computed from Yahoo Finance's own 2-year daily history (one call per
// symbol - no need to store our own history for these). PSX indices don't expose historical
// values via scraping (only today's weighted move), so those build up their own history
// over time from lib/indexHistory.js and show "insufficient history" until then.
const YF_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";

function pctBetween(series, idxFrom, idxTo) {
  const a = series[idxFrom], b = series[idxTo];
  if (a == null || b == null || a === 0) return null;
  return ((b - a) / a) * 100;
}

// Pakistan fiscal year starts July 1.
function fyStartTimestamp(nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const fyStartYear = m >= 6 ? y : y - 1;   // month 6 = July (0-indexed)
  return Date.UTC(fyStartYear, 6, 1) / 1000;
}

async function yfSeries(symbol) {
  try {
    const r = await fetch(`${YF_BASE}${encodeURIComponent(symbol)}?range=2y&interval=1d`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null;
    const j = await r.json();
    const res = j.chart?.result?.[0];
    if (!res || !res.timestamp) return null;
    const closes = res.indicators.quote[0].close;
    return res.timestamp.map((t, i) => ({ t, c: closes[i] })).filter(p => p.c != null);
  } catch (e) {
    return null;
  }
}

function breakdown(points) {
  if (!points || points.length < 2) return null;
  const closes = points.map(p => p.c);          // pctBetween works on plain numbers
  const lastIdx = points.length - 1;
  const last = points[lastIdx];
  const nowSec = last.t;
  const idxAtOrBefore = (targetSec) => {
    let best = 0;
    for (let i = 0; i < points.length; i++) { if (points[i].t <= targetSec) best = i; else break; }
    return best;
  };
  // "Day" = change vs the previous trading close (not a fixed 24h, which hits weekends).
  const dayIdx = lastIdx - 1;
  const weekIdx = idxAtOrBefore(nowSec - 7 * 86400);
  const monthIdx = idxAtOrBefore(nowSec - 30 * 86400);
  const yearIdx = idxAtOrBefore(nowSec - 365 * 86400);
  const fyIdx = idxAtOrBefore(fyStartTimestamp(nowSec * 1000));
  return {
    price: last.c,
    prev_close: closes[dayIdx],
    prev_close_date: new Date(points[dayIdx].t * 1000).toISOString().slice(0, 10),
    day_pct: pctBetween(closes, dayIdx, lastIdx),
    week_pct: pctBetween(closes, weekIdx, lastIdx),
    month_pct: pctBetween(closes, monthIdx, lastIdx),
    fy_pct: pctBetween(closes, fyIdx, lastIdx),
    year_pct: pctBetween(closes, yearIdx, lastIdx),
  };
}

export async function getGlobalTickers() {
  const symbols = { "Oil (WTI)": "CL=F", "Gold": "GC=F", "USD/PKR": "PKR=X", "Bitcoin": "BTC-USD" };
  const entries = await Promise.all(Object.entries(symbols).map(async ([label, sym]) => {
    const series = await yfSeries(sym);
    const b = breakdown(series);
    return { label, unit: label === "USD/PKR" ? "Rs." : label === "Oil (WTI)" ? "USD/bbl" : label === "Gold" ? "USD/oz" : "USD",
      status: b ? "OK" : "UNAVAILABLE", ...(b || {}), change_pct: b ? b.day_pct : null };
  }));
  return entries;
}

const PSX_INDICES = [
  { label: "KSE-100", symbol: "KSE100" },
  { label: "KSE-30", symbol: "KSE30" },
  { label: "KMI-30", symbol: "KMI30" },
  { label: "All Shares", symbol: "ALLSHR" },
];
export { PSX_INDICES };