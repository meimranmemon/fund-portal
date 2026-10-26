import { db } from "hatchable";

export const access = "user";
export const methods = ["POST"];

export default async function (req, res) {
  const { fund_id } = req.body || {};
  if (!fund_id) return res.status(400).json({ error: "fund_id required" });

  const { rowCount } = await db.query(
    "DELETE FROM funds WHERE id = $1 AND owner_user_id = $2",
    [fund_id, req.user.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: "Fund not found" });
  res.json({ deleted: true });
}