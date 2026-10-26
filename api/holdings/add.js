import { db } from "hatchable";

export const access = "user";
export const methods = ["POST"];

export default async function (req, res) {
  const { fund_id, company, ticker, weight_pct } = req.body || {};
  if (!fund_id || !company || weight_pct == null) {
    return res.status(400).json({ error: "fund_id, company, weight_pct are required" });
  }

  const { rows: owned } = await db.query(
    "SELECT id FROM funds WHERE id = $1 AND owner_user_id = $2",
    [fund_id, req.user.id]
  );
  if (owned.length === 0) return res.status(404).json({ error: "Fund not found" });

  const { rows } = await db.query(
    `INSERT INTO holdings (fund_id, company, ticker, weight_pct)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [fund_id, company, ticker || null, weight_pct]
  );
  res.json(rows[0]);
}