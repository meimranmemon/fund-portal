import { db } from "hatchable";
import { fetchAllNews, getCompanyAnnouncements, tagHeadline } from "./engine.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const MG = "https://mettisglobal.news";

function decodeEntities(s) {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ");
}

// Mettis Global has no RSS feed, so we read its (server-rendered) homepage for the latest
// article links, then read each NEW article's publish time from its page metadata.
async function fetchMettis() {
  try {
    const r = await fetch(MG + "/", { headers: { "User-Agent": UA } });
    if (!r.ok) return { items: [], error: `Mettis Global HTTP ${r.status}` };
    const html = await r.text();
    const seen = new Set(), links = [];
    for (const m of html.matchAll(/<a[^>]+href="(https:\/\/mettisglobal\.news\/[^"#?]+-\d{4,6})"[^>]*>([\s\S]{0,300}?)<\/a>/g)) {
      if (seen.has(m[1])) continue;
      const title = decodeEntities(m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      if (title.length < 25) continue;
      seen.add(m[1]); links.push({ href: m[1], title });
    }
    const top = links.slice(0, 18);
    if (!top.length) return { items: [] };
    const { rows: known } = await db.query(
      "SELECT link FROM news_items WHERE source_site='Mettis Global' AND link = ANY($1::text[])", [top.map(t => t.href)]);
    const have = new Set(known.map(k => k.link));
    const fresh = top.filter(t => !have.has(t.href));
    const dated = await Promise.all(fresh.map(async (t) => {
      let published = null;
      try {
        const a = await (await fetch(t.href, { headers: { "User-Agent": UA } })).text();
        const m = a.match(/"datePublished"\s*:\s*"([^"]+)"/);
        if (m) { const d = new Date(m[1]); if (!isNaN(d)) published = d.toISOString(); }
      } catch (e) { /* keep null -> now */ }
      return { source: "Mettis Global", headline: t.title, link: t.href, published_at: published || new Date().toISOString(), tags: tagHeadline(t.title) };
    }));
    return { items: dated };
  } catch (e) {
    return { items: [], error: "Mettis Global: " + e.message };
  }
}

// One single INSERT for all headlines (the platform allows only 100 DB calls / 10s per project).
export async function refreshNews() {
  const [generalNews, mettis] = await Promise.all([fetchAllNews(), fetchMettis()]);

  const { rows: tickerRows } = await db.query(
    `SELECT DISTINCT ticker FROM (
       SELECT ticker FROM holdings WHERE ticker IS NOT NULL
       UNION SELECT ticker FROM psx_lots WHERE ticker IS NOT NULL
     ) t LIMIT 40`);
  const tickers = tickerRows.map(r => r.ticker);
  const announceLists = await Promise.all(tickers.map(t => getCompanyAnnouncements(t)));
  const companyNews = announceLists.flat();

  const items = [...generalNews, ...mettis.items, ...companyNews];
  const errors = items.filter(i => i.error).map(i => ({ source: i.source, error: i.error }));
  if (mettis.error) errors.push({ source: "Mettis Global", error: mettis.error });
  const good = items.filter(i => !i.error && i.headline);
  let stored = 0;
  if (good.length) {
    const r = await db.query(
      `INSERT INTO news_items (source_site, headline, link, tags, published_at)
       SELECT x.s, x.h, x.l, x.t::jsonb, x.p
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::timestamptz[]) AS x(s, h, l, t, p)
       ON CONFLICT (source_site, headline) DO NOTHING`,
      [good.map(i => i.source), good.map(i => i.headline), good.map(i => i.link),
       good.map(i => JSON.stringify(i.tags || [])), good.map(i => i.published_at)]);
    stored = r.rowCount || 0;
  }
  return { stored, errors, total_fetched: good.length, mettis_new: mettis.items.length, companies_checked: tickers.length };
}