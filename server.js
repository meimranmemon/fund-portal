import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import admin from "firebase-admin";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;

// Initialize Firebase Admin if credentials are provided
let firebaseInitialized = false;
const saSource =
  process.env.FIREBASE_SERVICE_ACCOUNT ||
  (fs.existsSync(path.join(__dirname, "serviceAccountKey.json"))
    ? path.join(__dirname, "serviceAccountKey.json")
    : null);

if (saSource) {
  try {
    let serviceAccount;
    const raw = saSource.trim();
    if (raw.startsWith("{")) {
      serviceAccount = JSON.parse(raw);
    } else {
      serviceAccount = JSON.parse(fs.readFileSync(raw, "utf8"));
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseInitialized = true;
    console.log("Firebase Admin successfully initialized.");
  } catch (err) {
    console.warn("Warning: Could not initialize Firebase Admin:", err.message);
  }
} else {
  console.log("Note: FIREBASE_SERVICE_ACCOUNT or serviceAccountKey.json not found yet.");
}

// Multer in-memory storage for file uploads (CSV, PDF statements)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB max
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Upload middleware adapter to format req.files as expected by existing code
app.use(upload.any(), (req, res, next) => {
  if (req.files && Array.isArray(req.files)) {
    req.files = req.files.map((f) => ({
      field: f.fieldname,
      filename: f.originalname,
      contentType: f.mimetype,
      buffer: f.buffer,
    }));
  }
  next();
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Auto-mount all routes in api/
async function registerRoutes(dir, baseRoute = "/api") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await registerRoutes(fullPath, `${baseRoute}/${entry.name}`);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      const routeName = entry.name.replace(/\.js$/, "");
      const routePath = `${baseRoute}/${routeName}`;
      const fileUrl = pathToFileURL(fullPath).href;

      try {
        const mod = await import(fileUrl);
        const handler = mod.default;
        const access = mod.access;
        const methods = mod.methods;

        if (typeof handler !== "function") {
          console.warn(`Skipping ${routePath}: no default export function`);
          continue;
        }

        app.all(routePath, async (req, res, next) => {
          // Check HTTP method if specified by the module
          if (methods && Array.isArray(methods) && !methods.includes(req.method)) {
            return res.status(405).json({
              error: `Method ${req.method} not allowed. Supported: ${methods.join(", ")}`,
            });
          }

          // Scheduler auth check (for hourly-refresh)
          if (access === "scheduler") {
            const cronSecret = process.env.CRON_SECRET;
            const incomingSecret = req.headers["x-cron-secret"];
            if (!cronSecret || incomingSecret !== cronSecret) {
              return res.status(401).json({ error: "Unauthorized (invalid or missing x-cron-secret)" });
            }
          }

          // User auth check
          if (access === "user") {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith("Bearer ")) {
              return res.status(401).json({ error: "Unauthorized: Missing Bearer token" });
            }
            const token = authHeader.slice(7).trim();

            if (!firebaseInitialized) {
              return res.status(401).json({
                error: "Unauthorized: Firebase Admin is not configured on server",
              });
            }

            try {
              const decoded = await admin.auth().verifyIdToken(token);
              req.user = {
                id: decoded.uid,
                email: decoded.email || null,
              };
            } catch (err) {
              return res.status(401).json({ error: `Unauthorized: ${err.message}` });
            }
          }

          // Execute route handler
          try {
            await handler(req, res);
          } catch (err) {
            console.error(`Error in ${routePath}:`, err);
            if (!res.headersSent) {
              res.status(500).json({ error: err.message || "Internal server error" });
            }
          }
        });

        console.log(`Mounted [${methods ? methods.join(",") : "ALL"}] ${routePath} (access: ${access || "public"})`);
      } catch (err) {
        console.error(`Failed to load route module ${fullPath}:`, err);
        throw err;
      }
    }
  }
}

const apiDir = path.join(__dirname, "api");
await registerRoutes(apiDir);

// Static frontend serving
app.use(express.static(path.join(__dirname, "public")));
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Fallback for SPA routing if needed
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Route not found" });
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

export default app;
