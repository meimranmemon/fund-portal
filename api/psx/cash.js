import { db } from "hatchable";

export const access = "user";

// GET  -> { balance, ledger[] }
// POST { action:'add', type:'deposit'|'withdrawal', amount, trade_date, notes } -> adds manual entry
// POST { action:'delete', id } -> removes a manual deposit/withdrawal entry
export default async function (req, res) {
  if (req.method === "POST") {
    const { action, type, amount, trade_date, notes, id } = req.body || {};
    if (action === "delete") {
      const { rowCount } = await db.query(
        "DELETE FROM psx_cash_ledger WHERE id=$1 AND owner_user_id=$2 AND type IN ('deposit','withdrawal')",
        [id, req.user.id]);
      if (!rowCount) return res.status(404).json({ error: "Entry not found (only manual deposits/withdrawals can be deleted here)" });
      return res.json({ deleted: true });
    }
    const amt = Number(amount);
    if (!(amt > 0) || !['deposit', 'withdrawal'].includes(type)) {
      return res.status(400).json({ error: "type must be deposit or withdrawal, amount must be > 0" });
    }
    const signed = type === 'deposit' ? amt : -amt;
    const { rows } = await db.query(
      `INSERT INTO psx_cash_ledger (owner_user_id, type, amount, trade_date, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, type, signed, trade_date || new Date().toISOString().slice(0, 10), notes || null]);
    return res.json(rows[0]);
  }

  const { rows: ledger } = await db.query(
    `SELECT id, type, amount, trade_date, notes, related_lot_id, created_at FROM psx_cash_ledger
     WHERE owner_user_id=$1 ORDER BY trade_date DESC, created_at DESC LIMIT 200`, [req.user.id]);
  const { rows: bal } = await db.query(
    "SELECT COALESCE(SUM(amount),0) AS balance FROM psx_cash_ledger WHERE owner_user_id=$1", [req.user.id]);
  res.json({ balance: Number(bal[0].balance), ledger: ledger.map(l => ({ ...l, amount: Number(l.amount) })) });
}