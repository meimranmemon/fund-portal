import { db } from "hatchable";

export const access = "user";
export const methods = ["POST"];

export default async function (req, res) {
  const { fund_id, name, benchmark, total_investment_amount } = req.body || {};
  if (!fund_id) return res.status(400).json({ error: "fund_id required" });

  const { rows: owned } = await db.query(
    "SELECT id FROM funds WHERE id = $1 AND owner_user_id = $2",
    [fund_id, req.user.id]
  );
  if (owned.length === 0) return res.status(404).json({ error: "Fund not found" });

  const { rows } = await db.query(
    `UPDATE funds SET
       name = COALESCE($2, name),
       benchmark = COALESCE($3, benchmark),
       total_investment_amount = COALESCE($4, total_investment_amount),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [fund_id, name || null, benchmark || null, total_investment_amount ?? null]
  );
  res.json(rows[0]);
}