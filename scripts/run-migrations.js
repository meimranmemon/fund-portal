import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import dotenv from "dotenv";
import { parseDbConfig } from "../shim/index.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

async function migrate() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("Error: DATABASE_URL is not set in .env");
    process.exit(1);
  }

  const config = parseDbConfig(dbUrl);
  const pool = new pg.Pool(config);

  try {
    console.log("Connecting to database at", config.host, "port", config.port, "...");
    const client = await pool.connect();
    console.log("Connected successfully!");

    const sqlPath = path.join(rootDir, "migrations", "all_migrations.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");

    console.log("Running all migrations (001 to 008)...");
    await client.query(sql);
    console.log("All migrations executed successfully!");

    // Verify created tables
    const res = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    console.log("\n=== Tables in PostgreSQL Database ===");
    res.rows.forEach((r) => console.log(`  ✔ ${r.table_name}`));

    client.release();
    await pool.end();
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  }
}

migrate();
