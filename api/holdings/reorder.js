import { db } from "hatchable";

export const access = "user";
export const methods = ["POST"];

export default async function (req, res) {
  const { fund_id, holding_ids } = req.body || {};
  if (!fund_id || !Array.isArray(holding_ids)) {
    return res.status(400).json({ error: "fund_id and holding_ids array required" });
  }

  // Verify fund ownership
  const { rows: owned } = await db.query(
    "SELECT id FROM funds WHERE id = $1 AND owner_user_id = $2",
    [fund_id, req.user.id]
  );
  if (owned.length === 0) {
    return res.status(404).json({ error: "Fund not found" });
  }

  // Update sort order for each holding
  for (let i = 0; i < holding_ids.length; i++) {
    await db.query(
      "UPDATE holdings SET sort_order = $1, updated_at = now() WHERE id = $2 AND fund_id = $3",
      [i, holding_ids[i], fund_id]
    );
  }

  res.json({ success: true, count: holding_ids.length });
}
