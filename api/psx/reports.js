import { db } from "hatchable";

export const access = "user";

// Realized P/L grouped by sell_date, in every granularity the frontend might ask for.
// FY = Pakistan fiscal year (Jul 1 - Jun 30).
function fyLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  const startYear = m >= 7 ? y : y - 1;
  return `FY${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;
}

export default async function (req, res) {
  const { rows: sold } = await db.query(
    `SELECT sell_date, realized_pl, ticker, company, quantity, buy_price, sell_price,
            buy_commission, sell_commission, cgt_amount
     FROM psx_lots WHERE owner_user_id=$1 AND status='sold' ORDER BY sell_date ASC`, [req.user.id]);

  const group = (keyFn) => {
    const m = new Map();
    for (const r of sold) {
      const k = keyFn(r.sell_date);
      if (!m.has(k)) m.set(k, { period: k, realized_pl: 0, trades: 0 });
      const g = m.get(k);
      g.realized_pl += Number(r.realized_pl); g.trades++;
    }
    return [...m.values()];
  };

  const daily = group(d => d);
  const weekly = group(d => { const dt = new Date(d + "T00:00:00Z"); const onejan = new Date(Date.UTC(dt.getUTCFullYear(),0,1)); const wk = Math.ceil((((dt-onejan)/86400000)+onejan.getUTCDay()+1)/7); return `${dt.getUTCFullYear()}-W${String(wk).padStart(2,'0')}`; });
  const monthly = group(d => d.slice(0, 7));
  const yearly = group(d => d.slice(0, 4));
  const fiscalYear = group(fyLabel);
  const sinceInception = [{ period: "Since Inception", realized_pl: sold.reduce((s, r) => s + Number(r.realized_pl), 0), trades: sold.length }];

  res.json({ daily, weekly, monthly, yearly, fiscal_year: fiscalYear, since_inception: sinceInception, trades: sold });
}