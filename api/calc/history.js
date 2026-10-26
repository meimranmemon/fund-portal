import { db } from "hatchable";

export const access = "user";

// Profit/Loss and Investment history, grouped daily / weekly / monthly / yearly / FY
// (Pakistan fiscal year, 1 Jul - 30 Jun). The frontend's "Since Investment" view uses the
// daily series and accumulates it.
const PERIOD_EXPR = {
  daily: "s.trading_date",
  weekly: "date_trunc('week', s.trading_date)::date",
  monthly: "date_trunc('month', s.trading_date)::date",
  yearly: "date_trunc('year', s.trading_date)::date",
  fy: "(date_trunc('year', s.trading_date + interval '6 months') - interval '6 months')::date",
};

export default async function (req, res) {
  const { fund_id, period } = req.query || {};
  const expr = PERIOD_EXPR[period] || PERIOD_EXPR.daily;

  const params = [req.user.id];
  let filter = "";
  if (fund_id) { filter = "AND s.fund_id = $2"; params.push(fund_id); }

  const { rows } = await db.query(
    `WITH per_fund AS (
       SELECT ${expr} AS period_start, s.fund_id,
              SUM(s.total_gain_loss_amount) AS pl,
              (array_agg(COALESCE(s.investment_amount, f.total_investment_amount) ORDER BY s.trading_date DESC))[1] AS invested,
              COUNT(s.total_gain_loss_amount) AS days_counted,
              bool_or(s.source = 'backfill') AS has_backfill
       FROM fund_daily_summary s JOIN funds f ON f.id = s.fund_id
       WHERE s.owner_user_id = $1 ${filter}
       GROUP BY 1, 2)
     SELECT period_start::text AS period_start,
            COALESCE(SUM(pl), 0) AS total_gain_loss,
            COALESCE(SUM(invested), 0) AS invested,
            SUM(days_counted) AS days_counted,
            bool_or(has_backfill) AS has_backfill
     FROM per_fund GROUP BY period_start ORDER BY period_start ASC LIMIT 800`, params);
  res.json(rows.map(r => ({
    period_start: r.period_start,
    total_gain_loss: Number(r.total_gain_loss),
    invested: Number(r.invested),
    days_counted: Number(r.days_counted),
    has_backfill: !!r.has_backfill,
  })));
}