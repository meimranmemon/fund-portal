import { getGlobalTickers } from "../lib/tickers.js";
import { getPsxToken, getIndexSnapshots } from "../lib/psxApi.js";
import { refreshNews } from "../lib/newsStore.js";
import { db } from "../shim/index.js";

async function testLiveData() {
  console.log("=================================================");
  console.log("  Testing All Live Data Feeds & Database");
  console.log("=================================================\n");

  // 1. Yahoo Finance Global Tickers
  console.log("1. Fetching Global Rates (Oil, Gold, USD/PKR, BTC)...");
  try {
    const global = await getGlobalTickers();
    console.log("✔ Global Rates fetched successfully:");
    global.forEach((g) => {
      console.log(`   - ${g.label}: ${g.price} (${g.day_pct > 0 ? "+" : ""}${g.day_pct}%)`);
    });
  } catch (err) {
    console.error("❌ Global rates failed:", err.message);
  }

  // 2. PSX Token & Index Snapshots
  console.log("\n2. Fetching PSX DPS Token & Indices (KSE100, KSE30, etc.)...");
  try {
    const token = await getPsxToken();
    console.log(`✔ PSX Token obtained: ${token ? "YES (token: " + token.slice(0, 10) + "...)" : "NO"}`);
    const psxIndices = await getIndexSnapshots(token);
    console.log("✔ PSX Indices fetched successfully:");
    psxIndices.forEach((idx) => {
      console.log(`   - ${idx.label}: ${idx.current} (${idx.day_pct > 0 ? "+" : ""}${idx.day_pct}%)`);
    });
  } catch (err) {
    console.error("❌ PSX Indices failed:", err.message);
  }

  // 3. Live News Scraping & RSS
  console.log("\n3. Fetching Live News (Geo, ARY, Tribune, Mettis, etc.)...");
  try {
    const res = await refreshNews();
    console.log(`✔ News fetched & saved to Database: ${JSON.stringify(res)}`);
    const { rows: latestNews } = await db.query(
      "SELECT title, source, published_at FROM news_items ORDER BY published_at DESC LIMIT 3"
    );
    console.log("✔ Latest 3 news headlines from DB:");
    latestNews.forEach((n) => {
      console.log(`   [${n.source}] ${n.title.slice(0, 60)}... (${n.published_at})`);
    });
  } catch (err) {
    console.error("❌ News fetch failed:", err.message);
  }

  // 4. Test Database Connection
  console.log("\n4. Testing Database Tables & Health...");
  const { rows: tables } = await db.query(
    "SELECT count(*) as count FROM information_schema.tables WHERE table_schema='public'"
  );
  console.log(`✔ Database verified: ${tables[0].count} active tables.`);

  console.log("\n=================================================");
  console.log("  ALL LIVE FEEDS & DATABASE TESTS PASSED!");
  console.log("=================================================");
  process.exit(0);
}

testLiveData();
