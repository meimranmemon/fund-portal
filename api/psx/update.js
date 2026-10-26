import { db } from "hatchable";

export const access = "user";
export const methods = ["POST"];

// Edit an active lot (quantity/buy_price/buy_date corrections) or delete a mistaken entry.
export default async function (req, res) {
  const { lot_id, action, quantity, buy_price, buy_date, notes } = req.body || {};
  if (!lot_id) return res.status(400).json({ error: "lot_id required" });

  if (action === "delete") {
    // Remove any cash-ledger entries tied to this lot too, so deleting a mistaken/test entry
    // doesn't leave phantom cash movements behind.
    await db.query("DELETE FROM psx_cash_ledger WHERE related_lot_id=$1 AND owner_user_id=$2", [lot_id, req.user.id]);
    const { rowCount } = await db.query(
      "DELETE FROM psx_lots WHERE id=$1 AND owner_user_id=$2", [lot_id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: "Not found" });
    return res.json({ deleted: true });
  }
  const { rows } = await db.query(
    `UPDATE psx_lots SET quantity=COALESCE($2,quantity), buy_price=COALESCE($3,buy_price),
       buy_date=COALESCE($4,buy_date), notes=COALESCE($5,notes), updated_at=now()
     WHERE id=$1 AND owner_user_id=$6 AND status='active' RETURNING *`,
    [lot_id, quantity ?? null, buy_price ?? null, buy_date || null, notes ?? null, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: "Active holding not found" });
  res.json(rows[0]);
}