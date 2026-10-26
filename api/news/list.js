import { db } from "hatchable";
import { refreshNews } from "../../lib/newsStore.js";

export const access = "user";

export default async function (req, res) {
  // 1 query: newest fetch time + latest headlines together
  const { rows } = await db.query(
    `SELECT id, source_site, headline, link, tags, published_at, fetched_at,
            max(fetched_at) OVER () AS last_fetch
     FROM news_items WHERE published_at IS NOT NULL
     ORDER BY published_at DESC LIMIT 80`);
  const last = rows[0] && rows[0].last_fetch ? new Date(rows[0].last_fetch).getTime() : 0;
  if (Date.now() - last > 15 * 60 * 1000) {
    await refreshNews();
    const again = await db.query(
      `SELECT id, source_site, headline, link, tags, published_at
       FROM news_items WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 80`);
    return res.json({ items: again.rows });
  }
  res.json({ items: rows.map(({ last_fetch, fetched_at, ...r }) => r) });
}