import { buildFifoPlan } from "../../lib/psxImport.js";
import { db } from "hatchable";
import { defaultSettings } from "../../lib/psxCosts.js";

export const access = "user";
export const methods = ["POST"];

// Shows what WOULD happen (FIFO matching against current holdings) without writing anything -
// the user reviews/edits rows in the browser before calling /api/psx/import to actually commit.
export default async function (req, res) {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: "rows[] required" });

  const { rows: sRows } = await db.query("SELECT * FROM psx_settings WHERE owner_user_id=$1", [req.user.id]);
  const settings = sRows[0] || defaultSettings();

  try {
    const plan = await buildFifoPlan(req.user.id, rows, settings);
    res.json({
      plan_summary: {
        new_active_lots: plan.activeInserts.length,
        lots_reduced_or_closed: plan.activeUpdates.length,
        realized_trades: plan.soldInserts.length,
        total_realized_pl: plan.soldInserts.reduce((s, x) => s + x.realized_pl, 0),
      },
      active_preview: plan.activeInserts,
      sold_preview: plan.soldInserts,
      warnings: plan.warnings,
    });
  } catch (e) {
    res.status(e.isValidation ? 422 : 500).json({ error: String(e.message || e) });
  }
}