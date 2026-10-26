import { db } from "hatchable";
import { computeSale, defaultSettings } from "../../lib/psxCosts.js";

export const access = "user";
export const methods = ["POST"];

export default async function (req, res) {
  const { lot_id, sell_price, sell_date } = req.body || {};
  if (!lot_id || !sell_price) return res.status(400).json({ error: "lot_id and sell_price are required" });

  const { rows: lots } = await db.query(
    "SELECT * FROM psx_lots WHERE id=$1 AND owner_user_id=$2 AND status='active'", [lot_id, req.user.id]);
  if (!lots.length) return res.status(404).json({ error: "Active holding not found" });
  const lot = lots[0];

  const { rows: sRows } = await db.query("SELECT * FROM psx_settings WHERE owner_user_id=$1", [req.user.id]);
  const settings = sRows[0] || defaultSettings();
  const r = computeSale(lot, Number(sell_price), settings);
  const date = sell_date || new Date().toISOString().slice(0, 10);

  const { rows } = await db.query(
    `UPDATE psx_lots SET status='sold', sell_price=$2, sell_date=$3, sell_commission=$4,
       cgt_amount=$5, realized_pl=$6, updated_at=now() WHERE id=$1 RETURNING *`,
    [lot_id, sell_price, date, r.sellCommission, r.cgtAmount, r.netPl]);

  // Cash comes in: sale value minus brokerage/tax on the sale minus CGT
  const cashIn = Number(lot.quantity) * Number(sell_price) - r.sellCommission - r.cgtAmount;
  await db.query(
    `INSERT INTO psx_cash_ledger (owner_user_id, type, amount, related_lot_id, trade_date, notes)
     VALUES ($1,'sell',$2,$3,$4,$5)`,
    [req.user.id, cashIn, lot_id, date, `Sold ${lot.quantity} ${lot.ticker} @ ${sell_price}`]);

  res.json(rows[0]);
}