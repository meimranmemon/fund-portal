import { runForAllFunds } from "../../lib/calcEngine.js";
import { refreshNews } from "../../lib/newsStore.js";

export const access = "scheduler";
// Hourly during PSX hours (09:15-15:30 PKT = 04:15-10:30 UTC), Mon-Fri.
export const schedule = "0 4-11 * * 1-5";

export default async function (req, res) {
  const funds = await runForAllFunds();
  const news = await refreshNews();
  res.json({ ran_at: new Date().toISOString(), funds_processed: funds.length, news_stored: news.stored });
}