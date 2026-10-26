import { db } from "hatchable";

export const access = "user";
export const methods = ["POST"];

export default async function (req, res) {
  const { holding_id, company, ticker, weight_pct } = req.body || {};
  if (!holding_id) return res.status(400).json({ error: "holding_id required" });

  const { rows: owned } = await db.query(
    `SELECT h.id FROM holdings h
     JOIN funds f ON f.id = h.fund_id
     WHERE h.id = $1 AND f.owner_user_id = $2`,
    [holding_id, req.user.id]
  );
  if (owned.length === 0) return res.status(404).json({ error: "Holding not found" });

  const { rows } = await db.query(
    `UPDATE holdings SET
       company = COALESCE($2, company),
       ticker = COALESCE($3, ticker),
       weight_pct = COALESCE($4, weight_pct),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [holding_id, company || null, ticker || null, weight_pct ?? null]
  );
  res.json(rows[0]);
}