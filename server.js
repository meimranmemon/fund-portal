import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import { routes } from "./routes.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;

// ── Firebase Admin ─────────────────────────────────────────────────────────
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
    serviceAccount = raw.startsWith("{")
      ? JSON.parse(raw)
      : JSON.parse(fs.readFileSync(raw, "utf8"));

    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    firebaseInitialized = true;
    console.log("✔ Firebase Admin initialized.");
  } catch (err) {
    console.warn("⚠ Firebase Admin init warning:", err.message);
  }
} else {
  console.log("ℹ FIREBASE_SERVICE_ACCOUNT not set — auth disabled.");
}

// ── Middleware ──────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

app.use(cors({
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-cron-secret"],
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Multer adapter — normalise req.files for existing route handlers
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

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// ── Health ──────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) =>
  res.json({ status: "ok", time: new Date().toISOString(), vercel: !!process.env.VERCEL })
);

// ── Auth helper ─────────────────────────────────────────────────────────────
async function checkAuth(req, res, access) {
  if (access === "scheduler") {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || req.headers["x-cron-secret"] !== cronSecret) {
      res.status(401).json({ error: "Unauthorized: invalid x-cron-secret" });
      return false;
    }
    return true;
  }

  if (access === "user") {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized: Missing Bearer token" });
      return false;
    }
    if (!firebaseInitialized) {
      res.status(401).json({ error: "Unauthorized: Firebase Admin not configured on server" });
      return false;
    }
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.slice(7).trim());
      req.user = { id: decoded.uid, email: decoded.email || null };
    } catch (err) {
      res.status(401).json({ error: `Unauthorized: ${err.message}` });
      return false;
    }
  }

  return true;
}

// ── Register all API routes (static registry — bundler-safe) ───────────────
for (const { path: routePath, mod } of routes) {
  const handler = mod.default;
  const access  = mod.access;
  const methods = mod.methods;

  if (typeof handler !== "function") {
    console.warn(`Skipping ${routePath}: no default export`);
    continue;
  }

  app.all(routePath, async (req, res) => {
    if (methods && !methods.includes(req.method)) {
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }
    if (!(await checkAuth(req, res, access))) return;
    try {
      await handler(req, res);
    } catch (err) {
      console.error(`Error in ${routePath}:`, err);
      if (!res.headersSent)
        res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

  console.log(`Mounted [${methods ? methods.join(",") : "ALL"}] ${routePath} (access: ${access || "public"})`);
}

// ── Static frontend (HTML/CSS/JS) ───────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// SPA fallback
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ error: "API route not found" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Local dev: listen (Vercel calls the exported app directly) ──────────────
if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`Server listening on port ${port}`));
}

export default app;
