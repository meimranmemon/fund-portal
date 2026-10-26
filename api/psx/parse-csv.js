export const access = "user";
export const methods = ["POST"];

// Robust against Excel's regional quirks: different locales save CSV with different
// delimiters (comma/semicolon/tab) and reformat "2026-09-01" into local date styles
// (01-09-26, 09/01/2026, Excel serial numbers, etc). This parser copes with all of that.

function detectDelimiter(headerLine) {
  const counts = { ",": (headerLine.match(/,/g) || []).length, ";": (headerLine.match(/;/g) || []).length, "\t": (headerLine.match(/\t/g) || []).length };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function splitLine(line, delim) {
  // Minimal quoted-field support (handles "1,234" style quoted numbers too)
  const cells = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === delim && !inQuotes) { cells.push(cur); cur = ""; continue; }
    cur += c;
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}

function parseNumber(raw) {
  if (raw == null || raw === "") return 0;
  const cleaned = String(raw).replace(/,/g, "").replace(/\s/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

const MONTHS3 = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

function excelSerialToISO(n) {
  const ms = Math.round((n - 25569) * 86400 * 1000);   // Excel epoch -> Unix epoch
  const d = new Date(ms);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function parseFlexibleDate(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return s.replace(/-(\d)-/, "-0$1-").padStart(10, "0");
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) return s.replace(/\//g, "-");

  let m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if (m) {
    let [, d1, d2, y] = m;
    if (y.length === 2) y = (Number(y) < 50 ? "20" : "19") + y;
    // Ambiguous DD-MM vs MM-DD: if first part > 12 it must be the day.
    let day = d1, month = d2;
    if (Number(d1) <= 12 && Number(d2) > 12) { day = d2; month = d1; }   // looks like MM-DD-YYYY
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})$/);           // 01-Sep-2026 / 01 Sep 26
  if (m) {
    let [, d, mon, y] = m;
    const mi = MONTHS3.indexOf(mon.toLowerCase().slice(0, 3));
    if (mi !== -1) {
      if (y.length === 2) y = (Number(y) < 50 ? "20" : "19") + y;
      return `${y}-${String(mi + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  if (/^\d{4,6}(\.\d+)?$/.test(s)) {                                     // Excel serial date number
    const iso = excelSerialToISO(Number(s));
    if (iso) return iso;
  }

  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function mapHeader(cells) {
  const find = (...needles) => cells.findIndex(c => needles.some(n => c.toLowerCase().includes(n)));
  return {
    ticker: find("ticker", "symbol"),
    date: find("trade date", "date"),
    buyQty: find("buy qty", "buy quantity"),
    sellQty: find("sell qty", "sell quantity"),
    rate: find("rate", "price"),
    commission: find("commission", "comm"),
    other: find("other charges", "cdc", "other"),
  };
}

export default async function (req, res) {
  const file = (req.files || []).find(f => f.field === "file");
  if (!file) return res.status(400).json({ error: "No file received." });
  // IMPORTANT: file.buffer is a raw byte array (Uint8Array), not a Node Buffer in this
  // runtime. Calling .toString("utf-8") directly on it silently ignores the encoding and
  // joins the numeric byte values with commas instead of decoding text - that was the bug
  // that turned "Ticker," into "84,105,99,107,101,114,44". TextDecoder decodes it correctly.
  const text = new TextDecoder("utf-8").decode(file.buffer).replace(/^\uFEFF/, "");
  const rawLines = text.split(/\r?\n/).filter(l => l.trim());
  if (!rawLines.length) return res.status(422).json({ error: "File is empty." });

  const delim = detectDelimiter(rawLines.find(l => !l.trim().startsWith("#")) || rawLines[0]);
  const lines = rawLines.filter(l => !l.trim().startsWith("#"));
  if (!lines.length) return res.status(422).json({ error: "No data rows found (only comment/instruction lines)." });

  const headerCells = splitLine(lines[0], delim).map(c => c.toLowerCase());
  const looksLikeHeader = headerCells.some(c => c.includes("ticker") || c.includes("symbol"));
  let col = mapHeader(headerCells);
  let dataLines = looksLikeHeader ? lines.slice(1) : lines;

  // Fallback: if header-based column names weren't recognized (edited/reordered/renamed
  // header, or no header row at all), assume the template's original column ORDER:
  // Ticker, Trade Date, Buy Qty, Sell Qty, Rate, Commission, Other Charges.
  let usedFallbackOrder = false;
  if (col.ticker === -1 || col.rate === -1) {
    col = { ticker: 0, date: 1, buyQty: 2, sellQty: 3, rate: 4, commission: 5, other: 6 };
    dataLines = looksLikeHeader ? lines.slice(1) : lines;
    usedFallbackOrder = true;
  }

  const rows = [];
  const dateErrors = [];
  for (const line of dataLines) {
    const cells = splitLine(line, delim);
    const ticker = (cells[col.ticker] || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!ticker) continue;
    const buy_qty = parseNumber(cells[col.buyQty]);
    const sell_qty = parseNumber(cells[col.sellQty]);
    if (buy_qty <= 0 && sell_qty <= 0) continue;
    const trade_date = col.date !== -1 ? parseFlexibleDate(cells[col.date]) : null;
    if (!trade_date) { dateErrors.push(`${ticker} row: date "${cells[col.date]}" not understood`); continue; }
    rows.push({
      ticker, trade_date,
      buy_qty, sell_qty,
      rate: parseNumber(cells[col.rate]),
      commission: col.commission !== -1 ? parseNumber(cells[col.commission]) : 0,
      other_charges: col.other !== -1 ? parseNumber(cells[col.other]) : 0,
    });
  }

  if (!rows.length) {
    return res.status(422).json({
      error: "No valid rows found." + (dateErrors.length ? " Problems: " + dateErrors.slice(0, 5).join("; ") : ""),
      debug: { delimiter: delim === "\t" ? "tab" : delim, header_line: rawLines.find(l => !l.trim().startsWith("#")), used_fallback_order: usedFallbackOrder, columns_mapped: col },
    });
  }
  res.json({ rows, count: rows.length, warnings: dateErrors.slice(0, 10), delimiter_detected: delim === "\t" ? "tab" : delim, used_fallback_order: usedFallbackOrder });
}