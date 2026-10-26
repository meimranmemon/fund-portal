// Shared helpers - live PSX quotes + Pakistani news
//
// PSX: the JSON /timeseries endpoints are blocked by PSX's bot protection, but the normal
// server-rendered page https://dps.psx.com.pk/company/{TICKER} is open and contains the
// live price, previous close (LDCP) and the "As of" timestamp. We read that page.
const PSX_BASE = "https://dps.psx.com.pk";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const HEADERS = { "User-Agent": UA };

export function pktToday() {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

function num(s) {
  if (s == null) return null;
  const v = parseFloat(String(s).replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
// "Fri, Sep 25, 2026 4:49 PM" -> { date: "2026-09-25", iso: "2026-09-25T11:49:00.000Z" } (PKT = UTC+5)
function parseAsOf(raw) {
  const m = raw && raw.match(/([A-Za-z]{3}),?\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/);
  if (!m) return { date: null, iso: null };
  const mon = MONTHS[m[2]];
  const d = Number(m[3]), y = Number(m[4]);
  const date = `${y}-${String(mon + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  let iso = null;
  if (m[5]) {
    let hh = Number(m[5]) % 12;
    if (m[7] === "PM") hh += 12;
    iso = new Date(Date.UTC(y, mon, d, hh - 5, Number(m[6]))).toISOString();
  }
  return { date, iso };
}

function pnum(s) {
  if (s == null) return null;
  const t = String(s).trim(); const neg = /^\(.*\)$/.test(t);
  const v = parseFloat(t.replace(/[(),%\s]/g, ""));
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}
function parsePanel(html, name) {
  const start = html.indexOf(`data-name="${name}"><div`);
  if (start === -1) return null;
  let end = html.indexOf('class="tabs__panel"', start + 10);
  if (end === -1) end = start + 7000;
  const seg = html.slice(start, end);
  const headers = [...seg.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(x => x[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean);
  const rows = {};
  for (const m of seg.matchAll(/<tr><td>([^<]+)<\/td>((?:<td[^>]*>[\s\S]*?<\/td>)+)/g)) {
    const k = m[1].trim();
    if (!rows[k]) rows[k] = [...m[2].matchAll(/>([^<>]*)<\/span>/g)].map(y => pnum(y[1]));
  }
  return { headers, rows };
}
// Company results straight from PSX's company page: annual + quarterly EPS / profit, with growth.
function parseFundamentals(html) {
  try {
    const a = parsePanel(html, "Annual"), q = parsePanel(html, "Quarterly");
    const out = {};
    if (a && a.rows["EPS"] && a.rows["EPS"].length >= 2) {
      out.annual_years = a.headers.slice(0, a.rows["EPS"].length);
      out.eps_annual = a.rows["EPS"];
      out.pat_annual = a.rows["Profit after Taxation"] || null;
      out.sales_annual = a.rows["Sales"] || null;
      const [e0, e1] = out.eps_annual;
      out.eps_growth_annual = e0 != null && e1 ? ((e0 - e1) / Math.abs(e1)) * 100 : null;
    }
    if (q && q.rows["EPS"] && q.rows["EPS"].length >= 2) {
      const labels = q.headers.slice(0, q.rows["EPS"].length);
      out.q_labels = labels; out.eps_q = q.rows["EPS"]; out.q_label = labels[0];
      const m = /Q(\d)\s+(\d{4})/.exec(labels[0] || "");
      const j = m ? labels.indexOf(`Q${m[1]} ${Number(m[2]) - 1}`) : -1;
      const base = j >= 0 ? q.rows["EPS"][j] : null;
      out.eps_q_yoy_growth = base ? ((q.rows["EPS"][0] - base) / Math.abs(base)) * 100 : null;
    }
    const pi = html.indexOf("P/E Ratio");
    if (pi !== -1) { const m = html.slice(pi, pi + 300).match(/stats_value">\s*(-?[0-9,]+\.?[0-9]*)/); if (m) out.pe_ttm = num(m[1]); }
    return Object.keys(out).length ? out : null;
  } catch (e) { return null; }
}

export async function getLatestAndPrevious(ticker) {
  const fail = (status) => ({ date: null, current: null, previous: null, asof: null, status });
  try {
    const resp = await fetch(`${PSX_BASE}/company/${encodeURIComponent(ticker)}`, { headers: HEADERS });
    if (!resp.ok) return fail("PSX DATA UNAVAILABLE");
    const html = await resp.text();

    const cm = html.match(/quote__close">\s*Rs\.?\s*(-?[0-9,]+\.?[0-9]*)/);
    const current = cm ? num(cm[1]) : null;

    const stat = (label) => {
      const i = html.indexOf(">" + label + "<");
      if (i === -1) return null;
      const m = html.slice(i, i + 160).match(/stats_value">\s*(-?[0-9,]+\.?[0-9]*)/);
      return m ? num(m[1]) : null;
    };
    const previous = stat("LDCP");
    const dayHigh = stat("High");
    const dayLow = stat("Low");
    const dayOpen = stat("Open");
    const volume = stat("Volume");

    const dm = html.match(/quote__date">\s*[^A-Za-z]*As of ([^<]+)</);
    const asofRaw = dm ? dm[1].trim() : null;
    const parsed = parseAsOf(asofRaw);

    if (current == null || previous == null) return { ...fail("MANUAL VERIFICATION REQUIRED"), current, previous };
    return { date: parsed.date, current, previous, dayHigh, dayLow, dayOpen, volume, asof: asofRaw, asofIso: parsed.iso, fundamentals: parseFundamentals(html), status: "OK" };
  } catch (e) {
    return fail("PSX DATA UNAVAILABLE");
  }
}

export function dailyReturnPct(current, previous) {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
export function allocatedAmount(totalInvestment, weightPct) {
  if (totalInvestment == null || weightPct == null) return null;
  return (Number(totalInvestment) * Number(weightPct)) / 100;
}
export function gainLoss(allocated, returnPct) {
  if (allocated == null || returnPct == null) return null;
  return (allocated * returnPct) / 100;
}

// Benchmark daily return = index-weight-weighted average of constituent returns,
// from PSX's own constituents table (https://dps.psx.com.pk/indices/{KSE100|KMI30}).
export async function getIndexReturnBySymbol(symbol) {
  try {
    const resp = await fetch(`${PSX_BASE}/indices/${symbol}`, { headers: HEADERS });
    if (!resp.ok) return { returnPct: null, status: "PSX DATA UNAVAILABLE" };
    const html = await resp.text();
    let ws = 0, wt = 0;
    for (const row of html.matchAll(/<tr>[\s\S]*?<\/tr>/g)) {
      const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1].replace(/<[^>]+>/g, "").trim());
      if (cells.length < 7) continue;
      const ldcp = num(cells[2]), cur = num(cells[3]), w = num(cells[6]?.replace(/%/g, ""));
      if (!ldcp || cur == null || w == null) continue;
      ws += w * ((cur - ldcp) / ldcp) * 100;
      wt += w;
    }
    if (wt === 0) return { returnPct: null, status: "PSX DATA UNAVAILABLE" };
    return { returnPct: ws / wt, status: "OK" };
  } catch (e) {
    return { returnPct: null, status: "PSX DATA UNAVAILABLE" };
  }
}

export async function getBenchmarkReturn(benchmarkName) {
  const symbol = { "KSE-100": "KSE100", "KMI-30": "KMI30" }[benchmarkName];
  if (!symbol) return { returnPct: null, status: "DATA NOT AVAILABLE" };
  return getIndexReturnBySymbol(symbol);
}

// ---------------- News (Pakistani sources first) ----------------
export const NEWS_FEEDS = [
  { source: "Geo News", url: "https://www.geo.tv/rss/1/1" },
  { source: "Geo Business", url: "https://www.geo.tv/rss/1/3" },
  { source: "Jang (Urdu)", url: "https://jang.com.pk/rss/1/1" },
  { source: "ARY News", url: "https://arynews.tv/feed/" },
  { source: "ARY Business", url: "https://arynews.tv/category/business/feed/" },
  { source: "Express Tribune", url: "https://tribune.com.pk/feed/home" },
  { source: "Tribune Business", url: "https://tribune.com.pk/feed/business" },
  { source: "Business Recorder", url: "https://www.brecorder.com/feeds/markets" },
  { source: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml" },
  { source: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
];

// Company-specific "results" from PSX's own company page (server-rendered, not blocked):
// Financial Results / Board Meetings tabs. Used to surface "result of shares" the investor
// actually holds, tagged as PSX Announcement rather than generic news.
export async function getCompanyAnnouncements(ticker) {
  try {
    const resp = await fetch(`${PSX_BASE}/company/${encodeURIComponent(ticker)}`, { headers: HEADERS });
    if (!resp.ok) return [];
    const html = await resp.text();
    const out = [];
    for (const panelName of ["Financial Results", "Board Meetings"]) {
      const marker = `data-name="${panelName}"><table`;
      const start = html.indexOf(marker);
      if (start === -1) continue;
      const tableHtml = html.slice(start, html.indexOf("</table>", start) + 9);
      for (const row of tableHtml.matchAll(/<tr>[\s\S]*?<\/tr>/g)) {
        const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1]);
        if (cells.length < 2) continue;
        const date = cells[0].replace(/<[^>]+>/g, "").trim();
        const title = cells[1].replace(/<[^>]+>/g, "").trim();
        const pdfMatch = cells[2] && cells[2].match(/href="([^"]+\.pdf)"/);
        const d = new Date(date);
        if (!title || isNaN(d)) continue;
        out.push({
          source: `PSX Announcement (${ticker})`, headline: `${ticker}: ${title}`,
          link: pdfMatch ? PSX_BASE + pdfMatch[1] : `${PSX_BASE}/company/${ticker}`,
          published_at: d.toISOString(), tags: [panelName === "Financial Results" ? "Financial Results" : "Board Meeting", "Stock Market"],
        });
      }
    }
    return out.slice(0, 6);   // most recent few per ticker, per company
  } catch (e) {
    return [];
  }
}

const KEYWORD_TAGS = {
  // English
  "oil": "Oil & Gas", "gas": "Oil & Gas", "opec": "Oil & Gas", "crude": "Oil & Gas", "lng": "Oil & Gas",
  "fuel": "Fuel Prices", "petrol": "Fuel Prices", "diesel": "Fuel Prices",
  "gold": "Gold Price", "bullion": "Gold Price",
  "cement": "Cement", "fertilizer": "Fertilizer", "fertiliser": "Fertilizer", "urea": "Fertilizer",
  "bank": "Banking", "interest rate": "SBP / Interest Rate", "sbp": "SBP / Interest Rate",
  "state bank": "SBP / Interest Rate", "monetary policy": "SBP / Interest Rate", "policy rate": "SBP / Interest Rate",
  "imf": "IMF / Bailout", "bailout": "IMF / Bailout", "tranche": "IMF / Bailout", "loan": "IMF / Bailout",
  "war": "War / Geopolitics", "attack": "War / Geopolitics", "missile": "War / Geopolitics", "ceasefire": "War / Geopolitics",
  "iran": "War / Geopolitics", "israel": "War / Geopolitics", "gaza": "War / Geopolitics", "ukraine": "War / Geopolitics",
  "afghan": "War / Geopolitics", "india": "War / Geopolitics", "border": "War / Geopolitics", "terror": "War / Geopolitics",
  "election": "Politics", "parliament": "Politics", "pti": "Politics", "budget": "Politics", "court": "Politics",
  "power": "Power", "electricity": "Power", "tariff": "Power", "load shedding": "Power", "nepra": "Power",
  "steel": "Steel", "textile": "Textile", "auto": "Auto", "export": "Trade / Exports", "import": "Trade / Exports",
  "stock exchange": "Stock Market", "psx": "Stock Market", "kse": "Stock Market", "share": "Stock Market", "index": "Stock Market",
  "rupee": "Rupee / Dollar", "dollar": "Rupee / Dollar", "exchange rate": "Rupee / Dollar", "remittance": "Rupee / Dollar",
  "inflation": "Inflation", "cpi": "Inflation", "price hike": "Inflation",
  // Forex / economy / global markets (Mettis Global, Business Recorder etc.)
  "forex": "Rupee / Dollar", "currency": "Rupee / Dollar", "interbank": "Rupee / Dollar", "open market": "Rupee / Dollar", "pkr": "Rupee / Dollar",
  "gdp": "Economy", "economy": "Economy", "economic": "Economy", "fiscal": "Economy", "fbr": "Economy", "revenue": "Economy",
  "current account": "Economy", "reserves": "Economy", "world bank": "Economy", "adb": "Economy",
  "wall street": "Global Markets", "asian markets": "Global Markets", "nasdaq": "Global Markets", "dow jones": "Global Markets", "s&p": "Global Markets",
  "middle east": "War / Geopolitics", "russia": "War / Geopolitics", "troops": "War / Geopolitics", "airstrike": "War / Geopolitics",
  // Urdu
  "تیل": "Oil & Gas", "گیس": "Oil & Gas", "پیٹرول": "Fuel Prices", "ڈیزل": "Fuel Prices",
  "سونا": "Gold Price", "سونے": "Gold Price", "سیمنٹ": "Cement", "کھاد": "Fertilizer",
  "بینک": "Banking", "اسٹیٹ بینک": "SBP / Interest Rate", "شرح سود": "SBP / Interest Rate", "مانیٹری": "SBP / Interest Rate",
  "آئی ایم ایف": "IMF / Bailout", "قرض": "IMF / Bailout",
  "جنگ": "War / Geopolitics", "حملہ": "War / Geopolitics", "ایران": "War / Geopolitics", "اسرائیل": "War / Geopolitics",
  "غزہ": "War / Geopolitics", "بھارت": "War / Geopolitics", "افغان": "War / Geopolitics", "دہشت": "War / Geopolitics",
  "الیکشن": "Politics", "انتخاب": "Politics", "بجٹ": "Politics", "بجلی": "Power",
  "اسٹاک": "Stock Market", "حصص": "Stock Market", "پی ایس ایکس": "Stock Market",
  "ڈالر": "Rupee / Dollar", "روپیہ": "Rupee / Dollar", "روپے": "Rupee / Dollar",
  "مہنگائی": "Inflation", "قیمت": "Inflation",
};

export function tagHeadline(headline) {
  const h = headline.toLowerCase();
  const tags = new Set();
  for (const [kw, tag] of Object.entries(KEYWORD_TAGS)) {
    if (/^[a-z ]+$/.test(kw)) {
      if (new RegExp("\\b" + kw + "\\b").test(h)) tags.add(tag);   // whole-word for English
    } else if (h.includes(kw)) tags.add(tag);
  }
  return [...tags];
}

const clean = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#8217;|&#039;/g, "'")
  .replace(/&#8211;|&#8212;/g, "-").replace(/&quot;/g, '"').replace(/&#8220;|&#8221;/g, '"').trim();

function parseItems(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item[ >]([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const t = b.match(/<title>([\s\S]*?)<\/title>/);
    const l = b.match(/<link>([\s\S]*?)<\/link>/);
    const p = b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || b.match(/<dc:date>([\s\S]*?)<\/dc:date>/);
    if (!t) continue;
    let pub = null;
    if (p) { const d = new Date(clean(p[1])); if (!isNaN(d)) pub = d.toISOString(); }
    out.push({ headline: clean(t[1]), link: l ? clean(l[1]) : null, published_at: pub });
  }
  return out;
}

export async function fetchAllNews() {
  const maxAge = Date.now() - 4 * 24 * 3600 * 1000;
  const results = await Promise.all(NEWS_FEEDS.map(async ({ source, url }) => {
    try {
      const resp = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml, */*" } });
      if (!resp.ok) return [{ source, error: `FEED UNAVAILABLE (HTTP ${resp.status})` }];
      const items = parseItems(await resp.text()).slice(0, 25);
      return items
        .filter(i => i.published_at && new Date(i.published_at).getTime() >= maxAge)
        .map(i => ({ source, ...i, tags: tagHeadline(i.headline) }));
    } catch (e) {
      return [{ source, error: "FEED UNAVAILABLE: " + e.message }];
    }
  }));
  return results.flat();
}