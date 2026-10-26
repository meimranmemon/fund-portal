import { db } from "hatchable";

export const access = "user";

// Returns every fund of the signed-in investor with LIVE-recomputed numbers.
// Rupee figures are recomputed from the stored PSX price change each time, so editing
// investment amount or weights updates the numbers instantly (no PSX call needed).
export default async function (req, res) {
  const { rows: funds } = await db.query(
    "SELECT * FROM funds WHERE owner_user_id = $1 ORDER BY created_at ASC", [req.user.id]);

  for (const fund of funds) {
    const invested = Number(fund.total_investment_amount) || 0;
    const { rows: holdings } = await db.query(
      `SELECT h.*, d.trading_date, d.price_change_pct, d.data_status,
              d.current_price, d.previous_close, d.quote_asof
       FROM holdings h
       LEFT JOIN LATERAL (
         SELECT * FROM daily_gain_loss WHERE holding_id = h.id ORDER BY trading_date DESC LIMIT 1
       ) d ON true
       WHERE h.fund_id = $1 ORDER BY COALESCE(h.sort_order, 0) ASC, h.weight_pct DESC, h.created_at ASC`, [fund.id]);

    let holdingsGL = 0, priced = 0;
    for (const h of holdings) {
      h.weight_pct = Number(h.weight_pct);
      h.allocated_amount = invested * h.weight_pct / 100;
      const r = h.price_change_pct === null || h.price_change_pct === undefined ? null : Number(h.price_change_pct);
      h.price_change_pct = r;
      h.gain_loss_amount = r === null ? null : h.allocated_amount * r / 100;
      if (r !== null) { holdingsGL += h.gain_loss_amount; priced++; }
    }
    fund.holdings = holdings;
    fund.explicit_weightage_pct = Math.round(holdings.reduce((s, h) => s + h.weight_pct, 0) * 100) / 100;
    fund.remaining_market_pct = Math.round((100 - fund.explicit_weightage_pct) * 100) / 100;

    const { rows: sum } = await db.query(
      "SELECT * FROM fund_daily_summary WHERE fund_id = $1 ORDER BY trading_date DESC LIMIT 1", [fund.id]);
    const s = sum[0] || null;
    const benchRet = s && s.market_contribution_pct !== null ? Number(s.market_contribution_pct) : null;
    const marketAlloc = invested * Math.max(fund.remaining_market_pct, 0) / 100;
    const marketGL = benchRet === null ? null : marketAlloc * benchRet / 100;

    const complete = holdings.length > 0 && priced === holdings.length && (marketGL !== null || fund.remaining_market_pct <= 0);
    const total = holdingsGL + (marketGL || 0);
    fund.computed = {
      invested,
      trading_date: s ? String(s.trading_date).slice(0, 10) : null,
      benchmark_return_pct: benchRet,
      market_allocated: marketAlloc,
      market_gain_loss: marketGL,
      holdings_gain_loss: holdingsGL,
      priced_count: priced,
      holdings_count: holdings.length,
      complete,
      total_gain_loss: complete ? total : null,
      partial_gain_loss: priced > 0 ? total : null,
      total_return_pct: complete && invested > 0 ? (total / invested) * 100 : null,
      current_value: complete ? invested + total : null,
      validation_status: fund.explicit_weightage_pct > 100.0001 ? "WEIGHTAGE VALIDATION ERROR" : "OK",
      last_calculated: s ? s.created_at : null,
    };

    const tickDate = s ? s.trading_date : null;
    const { rows: ticks } = tickDate ? await db.query(
      `SELECT ts, total_gain_loss, total_return_pct FROM fund_ticks
       WHERE fund_id = $1 AND trading_date = $2 ORDER BY ts ASC LIMIT 400`, [fund.id, tickDate]) : { rows: [] };
    fund.ticks = ticks;
  }
  res.json({ server_time: new Date().toISOString(), funds });
}