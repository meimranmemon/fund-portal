import { db } from "hatchable";

export const access = "user";
export const methods = ["POST"];

export default async function (req, res) {
  const { holding_id } = req.body || {};
  if (!holding_id) return res.status(400).json({ error: "holding_id required" });

  const { rowCount } = await db.query(
    `DELETE FROM holdings WHERE id = $1 AND fund_id IN
       (SELECT id FROM funds WHERE owner_user_id = $2)`,
    [holding_id, req.user.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: "Holding not found" });
  res.json({ deleted: true });
}