import { db } from "hatchable";

export const access = "user";

// Whole-portfolio performance (invested + unrealized + realized) from daily snapshots,
// grouped daily / weekly / monthly / yearly. Change in total P/L between snapshots = that
// period's profit/loss. Snapshots are written on every PSX refresh (see api/psx/dashboard.js),
// so history builds up from the day this feature went live.
export default async function (req, res) {
  const { period } = req.query || {};
  const trunc = { weekly: "week", monthly: "month", yearly: "year" }[period] || "day";

  const { rows } = await db.query(
    `SELECT trading_date, invested_total, current_value_total, unrealized_total, realized_cumulative, cash_balance
     FROM psx_daily_summary WHERE owner_user_id=$1 ORDER BY trading_date ASC LIMIT 1500`, [req.user.id]);

  // total P/L at each snapshot = unrealized + cumulative realized
  const snaps = rows.map(r => ({
    date: String(r.trading_date).slice(0, 10),
    invested: Number(r.invested_total) || 0,
    value: r.current_value_total === null ? null : Number(r.current_value_total),
    total_pl: (r.unrealized_total === null ? null : Number(r.unrealized_total) + Number(r.realized_cumulative || 0)),
    cash: Number(r.cash_balance) || 0,
  }));

  const keyOf = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00Z");
    if (trunc === "year") return String(d.getUTCFullYear());
    if (trunc === "month") return dateStr.slice(0, 7);
    if (trunc === "week") {
      const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const wk = Math.ceil((((d - onejan) / 86400000) + onejan.getUTCDay() + 1) / 7);
      return `${d.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
    }
    return dateStr;
  };

  // Period P/L = last snapshot's total_pl in the period minus last snapshot's total_pl of the previous period.
  const groups = new Map();
  for (const s of snaps) {
    const k = keyOf(s.date);
    groups.set(k, s);                    // later snapshots overwrite -> last-of-period
  }
  const out = [];
  let prevPl = 0;
  for (const [k, s] of groups) {
    if (s.total_pl === null) continue;
    out.push({ period: k, period_pl: s.total_pl - prevPl, total_pl: s.total_pl, invested: s.invested, value: s.value, cash: s.cash });
    prevPl = s.total_pl;
  }
  res.json(out);
}