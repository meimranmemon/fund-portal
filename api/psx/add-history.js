import { db } from "hatchable";
import { buySideCosts, sellSideCosts, defaultSettings } from "../../lib/psxCosts.js";

export const access = "user";
export const methods = ["POST"];

// Manually record a trade that's already fully closed (buy AND sell both in the past) -
// for backfilling old history that happened before you started using this app.
export default async function (req, res) {
  const { company, ticker, quantity, buy_price, buy_date, sell_price, sell_date, notes } = req.body || {};
  if (!company || !ticker || !quantity || !buy_price || !buy_date || !sell_price || !sell_date) {
    return res.status(400).json({ error: "company, ticker, quantity, buy_price, buy_date, sell_price, sell_date are required" });
  }

  const { rows: sRows } = await db.query("SELECT * FROM psx_settings WHERE owner_user_id=$1", [req.user.id]);
  const settings = sRows[0] || defaultSettings();

  const buyCosts = buySideCosts(Number(buy_price), Number(quantity), settings);
  const sellCosts = sellSideCosts(Number(sell_price), Number(quantity), settings);
  const grossGain = (Number(sell_price) - Number(buy_price)) * Number(quantity);
  const gainAfterCosts = grossGain - buyCosts.total - sellCosts.total;
  const cgt = gainAfterCosts > 0 ? gainAfterCosts * (settings.cgt_pct / 100) : 0;
  const netPl = gainAfterCosts - cgt;

  const { rows } = await db.query(
    `INSERT INTO psx_lots (owner_user_id, company, ticker, quantity, buy_price, buy_date, buy_commission,
       status, sell_price, sell_date, sell_commission, cgt_amount, realized_pl, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'sold',$8,$9,$10,$11,$12,$13) RETURNING *`,
    [req.user.id, company, ticker.toUpperCase(), quantity, buy_price, buy_date, buyCosts.total,
     sell_price, sell_date, sellCosts.total, cgt, netPl, notes || "Manually added old history"]);
  res.json(rows[0]);
}