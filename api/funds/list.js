import { db } from "hatchable";

export const access = "user";

export default async function (req, res) {
  const { rows: funds } = await db.query(
    "SELECT * FROM funds WHERE owner_user_id = $1 ORDER BY created_at ASC",
    [req.user.id]
  );
  for (const fund of funds) {
    const { rows: holdings } = await db.query(
      "SELECT * FROM holdings WHERE fund_id = $1 ORDER BY weight_pct DESC",
      [fund.id]
    );
    fund.holdings = holdings;
    fund.explicit_weightage_pct = holdings.reduce((s, h) => s + Number(h.weight_pct), 0);
    fund.remaining_market_pct = Math.round((100 - fund.explicit_weightage_pct) * 100) / 100;
  }
  res.json(funds);
}