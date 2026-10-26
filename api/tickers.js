import { getGlobalTickers } from "../lib/tickers.js";
import { getPsxToken, getIndexSnapshots } from "../lib/psxApi.js";

export const access = "user";

// Global rates come from Yahoo Finance; PSX indices come from PSX's own official JSON API
// (live level, previous close, day high/low + exact week/month/FY/year from 5 years of daily closes).
export default async function (req, res) {
  const token = await getPsxToken();
  const [global, psx] = await Promise.all([getGlobalTickers(), getIndexSnapshots(token)]);
  res.json({ global, psx, psx_token_ok: !!token, server_time: new Date().toISOString() });
}