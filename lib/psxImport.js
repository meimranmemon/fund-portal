import { db } from "hatchable";
import { ai } from "hatchable";
import { buySideCosts, sellSideCosts, defaultSettings } from "./psxCosts.js";

// ---- Step 1: ask the model to read the statement and return structured rows ----
const EXTRACT_SYSTEM = `You read Pakistani stock brokerage / CDC statements (PDF).
Extract every trade row into a JSON array. Each item:
{
  "ticker": "SYMBOL",
  "trade_date": "YYYY-MM-DD",
  "buy_qty": number or 0,
  "sell_qty": number or 0,
  "rate": number,
  "commission": number,       // any broker commission/fee shown for this row (0 if not shown)
  "other_charges": number,    // CDC/other charges shown for this row (0 if not shown)
  "net_amount": number        // net amount shown for this row, if any, else null
}
Rules:
- One row is EITHER a buy (buy_qty>0, sell_qty=0) OR a sell (sell_qty>0, buy_qty=0). Never both.
- Skip subtotal/"Security Total"/"Client Total"/"Grand Total" rows - only individual trade lines.
- Use the trade date column (not settlement date) for trade_date.
- If a value isn't shown, use 0 for numbers.
- Return ONLY a raw JSON array, no markdown fences, no commentary.`;

export async function parseStatementWithAI(pdfBase64) {
  const result = await ai.generateText({
    purpose: "brokerage-statement-extract",
    model: "sonnet",
    maxTokens: 16000,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: EXTRACT_SYSTEM },
        { type: "file", data: pdfBase64, mediaType: "application/pdf" },
      ],
    }],
  });
  if (result.finishReason === "length") {
    throw new Error("Statement too long for one pass — split the PDF into smaller date ranges and upload separately.");
  }
  let text = result.text.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  let rows;
  try { rows = JSON.parse(text); } catch (e) {
    throw new Error("Could not parse the extracted data — the statement format may be unusual. Try a clearer PDF export.");
  }
  if (!Array.isArray(rows)) throw new Error("Unexpected extraction shape — expected a list of trades.");
  return rows
    .filter(r => r && r.ticker && (Number(r.buy_qty) > 0 || Number(r.sell_qty) > 0) && Number(r.rate) > 0)
    .map(r => ({
      ticker: String(r.ticker).toUpperCase().trim(),
      trade_date: r.trade_date,
      buy_qty: Number(r.buy_qty) || 0,
      sell_qty: Number(r.sell_qty) || 0,
      rate: Number(r.rate),
      commission: Number(r.commission) || 0,
      other_charges: Number(r.other_charges) || 0,
    }));
}

// ---- Step 2: FIFO-match buy/sell rows against each other and existing open lots ----
// Returns a plan {activeInserts, soldInserts, activeUpdates} - nothing is written to the DB here,
// so the caller can show a preview before committing (see api/psx/import.js).
export async function buildFifoPlan(ownerUserId, rows, settingsOverride) {
  const settings = settingsOverride || defaultSettings();

  // Defensive validation - never let a bad row reach raw SQL (this is what caused the
  // "invalid input syntax for type date" crash before parse-csv.js got stricter).
  const bad = [];
  for (const r of rows) {
    if (!r.ticker || !/^[A-Z0-9]{2,12}$/.test(r.ticker)) bad.push(`Invalid ticker "${r.ticker}"`);
    if (!r.trade_date || isNaN(new Date(r.trade_date)) || !/^\d{4}-\d{2}-\d{2}$/.test(r.trade_date)) bad.push(`${r.ticker || "?"}: invalid date "${r.trade_date}"`);
    if (!(Number(r.rate) > 0)) bad.push(`${r.ticker || "?"}: rate must be greater than 0`);
    if (!(Number(r.buy_qty) > 0) && !(Number(r.sell_qty) > 0)) bad.push(`${r.ticker || "?"}: needs a Buy Qty or Sell Qty greater than 0`);
    if (Number(r.buy_qty) > 0 && Number(r.sell_qty) > 0) bad.push(`${r.ticker || "?"}: a row can't have both Buy Qty and Sell Qty`);
  }
  if (bad.length) {
    const err = new Error("Some rows look wrong - fix them in the table and try again:\n" + bad.slice(0, 8).join("\n"));
    err.isValidation = true;
    throw err;
  }

  const tickers = [...new Set(rows.map(r => r.ticker))];
  const { rows: existingLots } = tickers.length
    ? await db.query(
        `SELECT * FROM psx_lots WHERE owner_user_id=$1 AND status='active' AND ticker = ANY($2::text[])
         ORDER BY buy_date ASC, created_at ASC`, [ownerUserId, tickers])
    : { rows: [] };

  const plan = { activeInserts: [], soldInserts: [], activeUpdates: [], warnings: [] };

  for (const ticker of tickers) {
    // Queue holds either {kind:'existing', id, qty, buy_price, buy_date, buy_commission_per_share}
    // or {kind:'new', qty, buy_price, buy_date, buy_commission_per_share}
    const queue = existingLots.filter(l => l.ticker === ticker).map(l => ({
      kind: "existing", id: l.id, qty: Number(l.quantity), buy_price: Number(l.buy_price),
      buy_date: l.buy_date, commPerShare: Number(l.buy_commission) / Number(l.quantity),
    }));

    const tickerRows = rows.filter(r => r.ticker === ticker)
      .sort((a, b) => new Date(a.trade_date) - new Date(b.trade_date));

    for (const row of tickerRows) {
      if (row.buy_qty > 0) {
        const costs = buySideCosts(row.rate, row.buy_qty, settings);
        const actualCost = (row.commission + row.other_charges) > 0 ? (row.commission + row.other_charges) : costs.total;
        queue.push({ kind: "new", qty: row.buy_qty, buy_price: row.rate, buy_date: row.trade_date,
          commPerShare: actualCost / row.buy_qty });
      } else if (row.sell_qty > 0) {
        let remaining = row.sell_qty;
        const sellCosts = sellSideCosts(row.rate, row.sell_qty, settings);
        const actualSellCost = (row.commission + row.other_charges) > 0 ? (row.commission + row.other_charges) : sellCosts.total;
        const sellCostPerShare = actualSellCost / row.sell_qty;

        while (remaining > 0 && queue.length) {
          const lot = queue[0];
          const take = Math.min(lot.qty, remaining);
          const buyCommission = lot.commPerShare * take;
          const sellCommission = sellCostPerShare * take;
          const grossGain = (row.rate - lot.buy_price) * take;
          const gainAfterCosts = grossGain - buyCommission - sellCommission;
          const cgt = gainAfterCosts > 0 ? gainAfterCosts * (settings.cgt_pct / 100) : 0;

          plan.soldInserts.push({
            ticker, quantity: take, buy_price: lot.buy_price, buy_date: lot.buy_date,
            buy_commission: buyCommission, sell_price: row.rate, sell_date: row.trade_date,
            sell_commission: sellCommission, cgt_amount: cgt, realized_pl: gainAfterCosts - cgt,
          });

          lot.qty -= take; remaining -= take;
          if (lot.kind === "existing") {
            if (lot.qty <= 0.0000001) plan.activeUpdates.push({ id: lot.id, action: "delete_consumed" });
            else plan.activeUpdates.push({ id: lot.id, action: "reduce", newQty: lot.qty,
              newCommission: lot.commPerShare * lot.qty });
          }
          if (lot.qty <= 0.0000001) queue.shift();
        }
        if (remaining > 0) {
          plan.warnings.push(`${ticker}: sell of ${row.sell_qty} on ${row.trade_date} exceeds known holdings by ${remaining.toFixed(2)} shares — extra treated as a new short-dated lot sold at cost (no prior buy found in statement or existing holdings).`);
          plan.soldInserts.push({
            ticker, quantity: remaining, buy_price: row.rate, buy_date: row.trade_date,
            buy_commission: 0, sell_price: row.rate, sell_date: row.trade_date,
            sell_commission: actualSellCost * (remaining / row.sell_qty), cgt_amount: 0, realized_pl: 0,
          });
        }
      }
    }

    // Whatever's left in the queue becomes (or stays) an active holding.
    for (const lot of queue) {
      if (lot.kind === "new") {
        plan.activeInserts.push({ ticker, quantity: lot.qty, buy_price: lot.buy_price,
          buy_date: lot.buy_date, buy_commission: lot.commPerShare * lot.qty });
      }
      // "existing" lots already have their reduce/delete recorded above when touched;
      // untouched existing lots need no action.
    }
  }
  return plan;
}

export async function commitFifoPlan(ownerUserId, plan, companiesByTicker) {
  for (const u of plan.activeUpdates) {
    if (u.action === "delete_consumed") {
      await db.query("DELETE FROM psx_lots WHERE id=$1 AND owner_user_id=$2", [u.id, ownerUserId]);
    } else {
      await db.query("UPDATE psx_lots SET quantity=$2, buy_commission=$3, updated_at=now() WHERE id=$1 AND owner_user_id=$4",
        [u.id, u.newQty, u.newCommission, ownerUserId]);
    }
  }
  for (const x of plan.activeInserts) {
    await db.query(
      `INSERT INTO psx_lots (owner_user_id, company, ticker, quantity, buy_price, buy_date, buy_commission, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`,
      [ownerUserId, companiesByTicker[x.ticker] || x.ticker, x.ticker, x.quantity, x.buy_price, x.buy_date, x.buy_commission]);
  }
  for (const x of plan.soldInserts) {
    await db.query(
      `INSERT INTO psx_lots (owner_user_id, company, ticker, quantity, buy_price, buy_date, buy_commission,
         status, sell_price, sell_date, sell_commission, cgt_amount, realized_pl)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'sold',$8,$9,$10,$11,$12)`,
      [ownerUserId, companiesByTicker[x.ticker] || x.ticker, x.ticker, x.quantity, x.buy_price, x.buy_date,
       x.buy_commission, x.sell_price, x.sell_date, x.sell_commission, x.cgt_amount, x.realized_pl]);
  }
}