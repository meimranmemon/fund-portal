import { db } from "hatchable";
import { buySideCosts, defaultSettings } from "../../lib/psxCosts.js";

export const access = "user";
export const methods = ["POST"];

export default async function (req, res) {
  const { company, ticker, quantity, buy_price, buy_date, notes } = req.body || {};
  if (!company || !ticker || !quantity || !buy_price) {
    return res.status(400).json({ error: "company, ticker, quantity, buy_price are required" });
  }
  const { rows: sRows } = await db.query("SELECT * FROM psx_settings WHERE owner_user_id=$1", [req.user.id]);
  const settings = sRows[0] || defaultSettings();
  const costs = buySideCosts(Number(buy_price), Number(quantity), settings);
  const date = buy_date || new Date().toISOString().slice(0, 10);

  const { rows } = await db.query(
    `INSERT INTO psx_lots (owner_user_id, company, ticker, quantity, buy_price, buy_date, buy_commission, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.user.id, company, ticker.toUpperCase(), quantity, buy_price, date, costs.total, notes || null]);
  const lot = rows[0];

  // Cash goes out: shares cost + brokerage + tax
  const cashOut = -(Number(quantity) * Number(buy_price) + costs.total);
  await db.query(
    `INSERT INTO psx_cash_ledger (owner_user_id, type, amount, related_lot_id, trade_date, notes)
     VALUES ($1,'buy',$2,$3,$4,$5)`,
    [req.user.id, cashOut, lot.id, date, `Bought ${quantity} ${ticker.toUpperCase()} @ ${buy_price}`]);

  res.json({ lot, costs });
}