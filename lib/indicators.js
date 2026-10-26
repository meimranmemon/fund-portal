// Technical indicators - standard, well-known formulas. Informational signals computed
// from price history, NOT a prediction and NOT financial advice.

export function sma(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}
export function stddev(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  return Math.sqrt(variance);
}
export function bollingerBands(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const sd = stddev(closes, period);
  if (mid == null || sd == null) return { upper: null, mid: null, lower: null };
  return { upper: mid + mult * sd, mid, lower: mid - mult * sd };
}
export function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
export function pivotPoints(high, low, close) {
  if (high == null || low == null || close == null) return null;
  const pivot = (high + low + close) / 3;
  const range = high - low;
  return {
    pivot, r1: 2 * pivot - low, s1: 2 * pivot - high,
    r2: pivot + range, s2: pivot - range,
    r3: high + 2 * (pivot - low), s3: low - 2 * (high - pivot),
  };
}

// Volatility as annualized-style % (stdev of daily returns over the window).
export function volatilityPct(closes, period = 20) {
  if (closes.length < period + 1) return null;
  const rets = [];
  for (let i = closes.length - period; i < closes.length; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1] * 100);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}

// Volume trend: today's volume vs its own 20-day average.
export function volumeTrend(volumes) {
  if (volumes.length < 6) return { trend: "INSUFFICIENT HISTORY", ratio: null };
  const period = Math.min(20, volumes.length - 1);
  const avg = volumes.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period;
  const today = volumes.at(-1);
  if (!avg) return { trend: "INSUFFICIENT HISTORY", ratio: null };
  const ratio = today / avg;
  return { trend: ratio >= 1.5 ? "SURGING" : ratio >= 1.1 ? "RISING" : ratio <= 0.7 ? "FALLING" : "NORMAL", ratio };
}

// Classic swing structure (HH/HL = uptrend, LH/LL = downtrend) using day-highs/lows.
// Finds local pivots (a bar higher/lower than both neighbours) over the recent window.
export function swingStructure(highs, lows) {
  const n = highs.length;
  if (n < 7) return { structure: "INSUFFICIENT HISTORY", pivots: [] };
  const swingHighs = [], swingLows = [];
  for (let i = 2; i < n - 2; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] && highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) swingHighs.push({ i, v: highs[i] });
    if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] && lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) swingLows.push({ i, v: lows[i] });
  }
  if (swingHighs.length < 2 || swingLows.length < 2) return { structure: "INSUFFICIENT HISTORY", pivots: [] };
  const lastTwoHighs = swingHighs.slice(-2), lastTwoLows = swingLows.slice(-2);
  const higherHigh = lastTwoHighs[1].v > lastTwoHighs[0].v;
  const higherLow = lastTwoLows[1].v > lastTwoLows[0].v;
  let structure;
  if (higherHigh && higherLow) structure = "HH/HL (uptrend)";
  else if (!higherHigh && !higherLow) structure = "LH/LL (downtrend)";
  else structure = "MIXED";
  return { structure, lastHigh: lastTwoHighs[1].v, lastLow: lastTwoLows[1].v, higherHigh, higherLow };
}

// Combine everything into one plain-rule signal with STRONG BUY / BUY / HOLD / SELL / STRONG SELL.
// Deliberately conservative/transparent - every reason is listed, nothing is hidden "AI magic".
export function buildSignal({ price, sma20, sma50, sma100, sma200, rsiVal, bb, pivots, volTrend, swing, historyDays }) {
  const reasons = [];
  let score = 0;

  if (rsiVal != null) {
    if (rsiVal < 30) { reasons.push(`RSI ${rsiVal.toFixed(1)} is oversold (<30)`); score += 1; }
    else if (rsiVal > 70) { reasons.push(`RSI ${rsiVal.toFixed(1)} is overbought (>70)`); score -= 1; }
  }
  if (bb && bb.lower != null) {
    if (price <= bb.lower) { reasons.push("Price at/below lower Bollinger Band"); score += 1; }
    else if (price >= bb.upper) { reasons.push("Price at/above upper Bollinger Band"); score -= 1; }
  }
  if (sma20 != null) { if (price > sma20) score += 0.5; else score -= 0.5; }
  if (sma50 != null) {
    if (price > sma50) { reasons.push("Price above SMA50 (short-term uptrend)"); score += 0.5; }
    else { reasons.push("Price below SMA50 (short-term downtrend)"); score -= 0.5; }
  }
  if (sma200 != null) {
    if (price > sma200) { reasons.push("Price above SMA200 (long-term uptrend)"); score += 0.5; }
    else { reasons.push("Price below SMA200 (long-term downtrend)"); score -= 0.5; }
  }
  if (pivots) {
    if (price > pivots.r1) { reasons.push(`Price broke above Resistance 1 (${pivots.r1.toFixed(2)}) - possible breakout`); score += 0.5; }
    else if (price < pivots.s1) { reasons.push(`Price broke below Support 1 (${pivots.s1.toFixed(2)}) - possible breakdown`); score -= 0.5; }
  }
  if (swing && swing.structure && swing.structure !== "INSUFFICIENT HISTORY") {
    if (swing.structure.includes("uptrend")) { reasons.push("Swing structure: Higher Highs / Higher Lows (uptrend)"); score += 0.5; }
    else if (swing.structure.includes("downtrend")) { reasons.push("Swing structure: Lower Highs / Lower Lows (downtrend)"); score -= 0.5; }
  }
  if (volTrend && volTrend.trend === "SURGING") { reasons.push("Volume surging (≥1.5x 20-day average) - conviction behind the move"); score += (score >= 0 ? 0.5 : -0.5); }

  if (historyDays < 20 && rsiVal == null) {
    return { signal: "INSUFFICIENT HISTORY", reasons: [`Only ${historyDays} trading day(s) of price history collected so far - need more days for reliable signals.`], score: 0 };
  }
  let signal = "HOLD";
  if (score >= 2) signal = "STRONG BUY";
  else if (score >= 1) signal = "BUY";
  else if (score <= -2) signal = "STRONG SELL";
  else if (score <= -1) signal = "SELL";
  return { signal, reasons, score };
}

// Simple, transparent take-profit suggestion: the next resistance level above price,
// or (if already above R2) R3 - purely mechanical, not a prediction.
export function suggestTakeProfit(price, pivots) {
  if (!pivots) return null;
  if (price < pivots.r1) return { level: pivots.r1, label: "R1" };
  if (price < pivots.r2) return { level: pivots.r2, label: "R2" };
  return { level: pivots.r3, label: "R3" };
}