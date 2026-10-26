import { db } from "hatchable";
import { defaultSettings } from "../../lib/psxCosts.js";

export const access = "user";

export default async function (req, res) {
  if (req.method === "POST") {
    const b = req.body || {};
    const d = defaultSettings();
    const s = {
      govt_tax_pct: b.govt_tax_pct ?? d.govt_tax_pct, cgt_pct: b.cgt_pct ?? d.cgt_pct,
      slab1_max: b.slab1_max ?? d.slab1_max, slab1_paisa: b.slab1_paisa ?? d.slab1_paisa,
      slab2_pct: b.slab2_pct ?? d.slab2_pct,
    };
    const { rows } = await db.query(
      `INSERT INTO psx_settings (owner_user_id, govt_tax_pct, cgt_pct, slab1_max, slab1_paisa, slab2_pct)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (owner_user_id) DO UPDATE SET govt_tax_pct=$2, cgt_pct=$3, slab1_max=$4, slab1_paisa=$5, slab2_pct=$6, updated_at=now()
       RETURNING *`,
      [req.user.id, s.govt_tax_pct, s.cgt_pct, s.slab1_max, s.slab1_paisa, s.slab2_pct]);
    return res.json(rows[0]);
  }
  const { rows } = await db.query("SELECT * FROM psx_settings WHERE owner_user_id=$1", [req.user.id]);
  res.json(rows[0] || { owner_user_id: req.user.id, ...defaultSettings() });
}