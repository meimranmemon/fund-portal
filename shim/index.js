import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

// Configure DATE parser (OID 1082) to return plain "YYYY-MM-DD" string
pg.types.setTypeParser(1082, (v) => v);

export function parseDbConfig(connectionString) {
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not defined");
  }

  if (connectionString.startsWith("postgresql://") || connectionString.startsWith("postgres://")) {
    try {
      const rest = connectionString.split("://")[1];
      const lastAt = rest.lastIndexOf("@");
      if (lastAt !== -1) {
        const userPass = rest.slice(0, lastAt);
        const hostPortDb = rest.slice(lastAt + 1);
        const firstColon = userPass.indexOf(":");
        const user = firstColon !== -1 ? userPass.slice(0, firstColon) : userPass;
        const password = firstColon !== -1 ? userPass.slice(firstColon + 1) : "";
        const hostPort = hostPortDb.split("/")[0].split("?")[0];
        const database = hostPortDb.split("/")[1]?.split("?")[0] || "postgres";
        const [host, port] = hostPort.split(":");

        const isLocalOrSocket =
          host.includes("localhost") ||
          host.includes("127.0.0.1") ||
          host.includes("/cloudsql/") ||
          host.includes("host=/cloudsql");

        return {
          host,
          port: port ? Number(port) : 5432,
          user,
          password,
          database,
          ssl: process.env.DB_SSL === "false" || isLocalOrSocket ? false : { rejectUnauthorized: false },
          max: 10,
          idleTimeoutMillis: 30000,
        };
      }
    } catch (e) {
      // Fallback
    }
  }

  return {
    connectionString,
    ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
  };
}

let poolInstance = null;

function getPool() {
  if (!poolInstance) {
    const config = parseDbConfig(process.env.DATABASE_URL);
    poolInstance = new pg.Pool(config);
  }
  return poolInstance;
}

export const db = {
  query: async (sql, params) => {
    const pool = getPool();
    const res = await pool.query(sql, params);
    return {
      rows: res.rows,
      rowCount: res.rowCount,
    };
  },
  get pool() {
    return getPool();
  },
};

export const ai = {
  generateText: async () => {
    throw new Error("no API key configured (PDF statement extraction is disabled)");
  },
};

export default { db, ai };
