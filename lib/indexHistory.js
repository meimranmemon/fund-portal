import { db } from "hatchable";
import { getIndexReturnBySymbol } from "./engine.js";
import { PSX_INDICES } from "./tickers.js";

// Logs today's daily %move for every PSX index (one row/day each) so we can compound them
// into weekly/monthly/FY/yearly breakdowns over time - PSX itself doesn't expose that
// history via scraping, only today's live move, so this has to be built up day by day.
export async function logPsxIndexSnapshots() {
  const today = new Date().toISOString().slice(0, 10);
  const results = await Promise.all(PSX_INDICES.map(async (idx) => {
    const r = await getIndexReturnBySymbol(idx.symbol);
    return { label: idx.label, pct: r.status === "OK" ? r.returnPct : null };
  }));
  const good = results.filter(r => r.pct !== null);
  if (good.length) {
    await db.query(
      `INSERT INTO index_history (index_label, trading_date, return_pct)
       SELECT * FROM unnest($1::text[], $2::date[], $3::numeric[])
       ON CONFLICT (index_label, trading_date) DO UPDATE SET return_pct = EXCLUDED.return_pct, recorded_at = now()`,
      [good.map(r => r.label), good.map(() => today), good.map(r => r.pct)]);
  }
  return results;
}

function fyStartDate(d) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const fyY = m >= 6 ? y : y - 1;
  return new Date(Date.UTC(fyY, 6, 1));
}

function compound(rows) {
  if (!rows.length) return null;
  let factor = 1;
  for (const r of rows) factor *= (1 + Number(r.return_pct) / 100);
  return (factor - 1) * 100;
}

export async function getPsxIndexBreakdown() {
  const { rows } = await db.query(
    `SELECT index_label, trading_date, return_pct FROM index_history
     WHERE index_label = ANY($1::text[]) ORDER BY trading_date ASC`,
    [PSX_INDICES.map(i => i.label)]);
  const byLabel = new Map();
  for (const r of rows) { if (!byLabel.has(r.index_label)) byLabel.set(r.index_label, []); byLabel.get(r.index_label).push(r); }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const monthAgo = new Date(now.getTime() - 30 * 86400000);
  const yearAgo = new Date(now.getTime() - 365 * 86400000);
  const fyStart = fyStartDate(now);

  return PSX_INDICES.map(idx => {
    const hist = byLabel.get(idx.label) || [];
    const since = (from) => hist.filter(r => new Date(r.trading_date) >= from);
    const latest = hist.at(-1);
    return {
      label: idx.label,
      day_pct: latest ? Number(latest.return_pct) : null,
      week_pct: compound(since(weekAgo)),
      month_pct: compound(since(monthAgo)),
      fy_pct: compound(since(fyStart)),
      year_pct: compound(since(yearAgo)),
      history_days: hist.length,
    };
  });
}