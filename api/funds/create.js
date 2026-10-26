import { db } from "hatchable";

export const access = "user";
export const methods = ["POST"];

export default async function (req, res) {
  const { name, benchmark, total_investment_amount } = req.body || {};
  if (!name) return res.status(400).json({ error: "Fund name is required" });

  const { rows } = await db.query(
    `INSERT INTO funds (owner_user_id, name, benchmark, total_investment_amount)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.user.id, name, benchmark || "KSE-100", total_investment_amount || 0]
  );
  res.json(rows[0]);
}