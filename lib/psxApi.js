// Official PSX Data Portal JSON API (dps.psx.com.pk).
// PSX protects these endpoints with a per-page token: every page embeds window.__ps._k and
// PSX's own JavaScript sends it back as an "X-Req-Id" header. We do the same - fetch the home
// page, read the token, then call the JSON endpoints exactly like PSX's own site does.
//   /timeseries/eod/{SYMBOL}  -> [[ts, close, volume, open], ...]  newest first (~5 years)
//   /timeseries/int/{SYMBOL}  -> [[ts, price, volume], ...]        newest first (today's ticks)
const BASE = "https://dps.psx.com.pk";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export const PSX_INDEX_LIST = [
  { label: "KSE-100", symbol: "KSE100" },
  { label: "KSE-30", symbol: "KSE30" },
  { label: "KMI-30", symbol: "KMI30" },
  { label: "KMI-All Share", symbol: "KMIALLSHR" },
  { label: "KSE-All Share", symbol: "ALLSHR" },
];

export const pktDate = (ts) => new Date((ts + 5 * 3600) * 1000).toISOString().slice(0, 10);

export async function getPsxToken() {
  try {
    const r = await fetch(BASE + "/", { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/"_k":"([^"]+)"/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

async function psxJson(path, token) {
  if (!token) return null;
  try {
    const r = await fetch(BASE + path, { headers: {
      "User-Agent": UA, "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest", "X-Req-Id": token, "Referer": BASE + "/" } });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.status === 1 && Array.isArray(j.data) ? j.data : null;
  } catch (e) { return null; }
}

// Ascending list of {date, ts, close, volume, open}
export async function getEod(symbol, token) {
  const data = await psxJson(`/timeseries/eod/${encodeURIComponent(symbol)}`, token);
  if (!data || !data.length) return null;
  return data.map(r => ({ ts: r[0], date: pktDate(r[0]), close: Number(r[1]), volume: Number(r[2]) || 0, open: Number(r[3]) }))
    .reverse();
}

// Newest-first ticks of today's session.
export async function getIntraday(symbol, token) {
  const data = await psxJson(`/timeseries/int/${encodeURIComponent(symbol)}`, token);
  if (!data || !data.length) return null;
  return data.map(r => ({ ts: r[0], price: Number(r[1]), volume: Number(r[2]) || 0 }));
}

// Merge the latest live price into the EOD series so "today" is always the live value.
export function mergeLive(eod, livePrice, liveDate, liveVolume) {
  const series = eod.map(p => ({ ...p }));
  if (livePrice == null || !liveDate) return series;
  const last = series[series.length - 1];
  if (last && last.date === liveDate) { last.close = livePrice; if (liveVolume != null) last.volume = liveVolume; }
  else if (!last || liveDate > last.date) series.push({ ts: null, date: liveDate, close: livePrice, volume: liveVolume || 0, open: null });
  return series;
}

const addDays = (dateStr, n) => new Date(new Date(dateStr + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
function fyStart(dateStr) {
  const y = Number(dateStr.slice(0, 4)), m = Number(dateStr.slice(5, 7));
  return `${m >= 7 ? y : y - 1}-07-01`;
}

// Period moves from a series of closes. Baselines are "last close on/before the target date";
// FY baseline = last close BEFORE 1 July (the previous fiscal year's final close).
export function periodStats(series) {
  if (!series || series.length < 2) return null;
  const n = series.length, last = series[n - 1], prev = series[n - 2];
  const at = (target, strict = false) => {
    let best = null;
    for (const p of series) { if (strict ? p.date < target : p.date <= target) best = p; else break; }
    return best;
  };
  const pct = (base) => base && base.close ? ((last.close - base.close) / base.close) * 100 : null;
  const week = at(addDays(last.date, -7)), month = at(addDays(last.date, -30)),
        year = at(addDays(last.date, -365)), fy = at(fyStart(last.date), true);
  return {
    current: last.close, as_of_date: last.date,
    prev_close: prev.close, prev_close_date: prev.date,
    day_pct: pct(prev), week_pct: pct(week), month_pct: pct(month), fy_pct: pct(fy), year_pct: pct(year),
    week_base: week ? week.close : null, month_base: month ? month.close : null,
    fy_base: fy ? fy.close : null, year_base: year ? year.close : null,
  };
}

// True previous close = last official EOD close strictly BEFORE the live trading date.
// (After market close PSX's company page shows LDCP = today's close, which makes the
// day change read 0 - so we never trust that field for the previous close.)
export function prevFromEod(eod, liveDate) {
  if (!eod || !liveDate) return null;
  for (let i = eod.length - 1; i >= 0; i--) if (eod[i].date < liveDate) return eod[i].close;
  return null;
}

// Merged (history + live) daily series for an index - used for fund benchmarks and backfill.
export async function getIndexSeries(symbol, token) {
  const [eod, ticks] = await Promise.all([getEod(symbol, token), getIntraday(symbol, token)]);
  if (!eod) return null;
  return ticks && ticks.length ? mergeLive(eod, ticks[0].price, pktDate(ticks[0].ts)) : eod;
}

// Official PSX index snapshot: live level, previous close, day high/low, and exact
// week/month/FY/year moves from PSX's own 5-year daily history.
export async function getIndexSnapshots(token) {
  const out = [];
  for (let i = 0; i < PSX_INDEX_LIST.length; i += 3) {          // gentle batches of 3
    const batch = PSX_INDEX_LIST.slice(i, i + 3);
    const res = await Promise.all(batch.map(async (idx) => {
      const [eod, ticks] = await Promise.all([getEod(idx.symbol, token), getIntraday(idx.symbol, token)]);
      if (!eod) return { label: idx.label, symbol: idx.symbol, status: "PSX DATA UNAVAILABLE" };
      let livePrice = null, liveDate = null, hi = null, lo = null, open = null, asOf = null;
      if (ticks && ticks.length) {
        livePrice = ticks[0].price; liveDate = pktDate(ticks[0].ts);
        asOf = new Date(ticks[0].ts * 1000).toISOString();
        const today = ticks.filter(t => pktDate(t.ts) === liveDate);
        hi = Math.max(...today.map(t => t.price)); lo = Math.min(...today.map(t => t.price));
        open = today[today.length - 1].price;
      }
      const series = mergeLive(eod, livePrice, liveDate);
      const st = periodStats(series);
      return { label: idx.label, symbol: idx.symbol, status: st ? "OK" : "PSX DATA UNAVAILABLE",
        ...(st || {}), day_high: hi, day_low: lo, day_open: open, as_of: asOf };
    }));
    out.push(...res);
  }
  return out;
}