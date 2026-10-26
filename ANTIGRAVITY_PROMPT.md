# Prompt for Google Antigravity (paste this into the agent chat)

You are migrating an existing, working Node.js (ESM) web app from the "Hatchable" runtime to a standard stack. The folder you opened is the full project. DO NOT rewrite business logic in `lib/` or the SQL in `api/` — only add the runtime around it. Work step by step and show me proof (terminal output) after each step.

## What the app is
PSX (Pakistan Stock Exchange) investor portal: Mutual Funds tab + PSX Portfolio tab, live PSX prices, signals/backtest, news, CSV trade import. Backend = `api/**/*.js` (one file = one route) + `lib/*.js`. Frontend = `public/index.html` (single-page app), `public/login.html`, `public/theme.css`. DB schema = `migrations/001..008_*.sql` (run in order).

## Target stack (all free)
- DB: Supabase Postgres (use the **Session pooler** connection string, in env `DATABASE_URL`)
- Auth: Firebase Authentication, Google sign-in. Backend verifies the Firebase ID token (`Authorization: Bearer <token>`) with firebase-admin (`FIREBASE_SERVICE_ACCOUNT` env var, JSON string). `req.user.id` = Firebase `uid`, `req.user.email` = email.
- Hosting: Render (web service, free), `npm start`.

## Tasks
1. Create `package.json` (type: module; deps: express, pg, multer, firebase-admin, dotenv) and `.env.example` (DATABASE_URL, FIREBASE_SERVICE_ACCOUNT, CRON_SECRET, PORT). Never ask me to paste secrets into chat; I will fill `.env` myself.
2. Create a shim module so `import { db } from "hatchable"` and `import { ai } from "hatchable"` keep working unchanged (e.g. a `shim/hatchable.js` + a package.json `imports`/`exports` mapping or an alias in the loader — choose the least invasive way).
   - `db.query(sql, params)` → `pg` Pool query, returns `{ rows, rowCount }`.
   - IMPORTANT: configure `pg.types.setTypeParser(1082, v => v)` so DATE columns come back as plain `"YYYY-MM-DD"` strings (the code does `.slice(0,10)` and `d.slice(0,7)` on dates). Keep TIMESTAMPTZ as normal Date.
   - `ai`: stub whose `generateText` throws `new Error("no API key configured")` (PDF statement extraction is intentionally disabled — no paid AI). Keep CSV import working.
3. Create `server.js` (Express) that auto-mounts every `api/**/*.js` file at `/api/<path without .js>` (e.g. `api/psx/buy.js` → `POST /api/psx/buy`, `api/tickers.js` → `/api/tickers`). Each module exports: `default async (req,res)`, optional `access` ("user" | "scheduler"), optional `methods` array (reject other methods with 405).
   - `access = "user"` → require valid Firebase token, else 401 JSON.
   - `access = "scheduler"` (only `api/calc/hourly-refresh.js`) → require header `x-cron-secret` equal to `CRON_SECRET`, else 401.
   - Provide `req.body` (JSON), `req.query`, `req.method`, `req.user`, and `req.files` (via multer memory storage) as an array of `{ field, filename, contentType, buffer }` where `buffer` is a `Uint8Array` (code uses `new TextDecoder().decode(file.buffer)`).
   - `res.json`, `res.status`, `res.setHeader`, `res.send` are standard Express.
   - Serve `public/` statically; `/` → `index.html`.
4. Fix the one wrong import path: `api/tickers.js` imports `"../../lib/..."` but in this layout it must be `"../lib/..."`. Check every other import path resolves.
5. Frontend: `public/index.html` and `public/login.html` use a `hatchable` client object (`hatchable.auth.*`, and fetch calls to `/api/...`). Replace it with Firebase Web SDK (Google sign-in popup). Every `/api` fetch must send `Authorization: Bearer <fresh ID token>`. Redirect to login when signed out. Leave all UI/layout/charts untouched. Put the Firebase web config in one clearly marked block that I will fill in.
6. Add a short `README_DEPLOY.md` with exact steps: create Supabase project → run migrations in order in the SQL editor → create Firebase project + enable Google sign-in + add the Render domain to authorized domains → set env vars on Render → deploy → set up a free cron (cron-job.org) to call `POST https://<app>/api/calc/hourly-refresh` with header `x-cron-secret`, Mon–Fri, every hour 04:00–11:00 UTC.
7. Run locally: `npm install`, `npm start`, then smoke-test with curl: unauthenticated `/api/funds/list` → 401; `/api/psx/template` (with a valid token) → CSV; every route file loads without import errors (`node --check` + a script that imports each file).
8. Give me a checklist of every page/tab/button to click to verify nothing is broken (Funds tab, PSX tab, CSV import, charts, ticker strip, news, theme toggle, login/logout).

## Rules
- Do not change anything in `lib/` except if an import fails; explain any change.
- Keep all SQL as is.
- No paid services, no credit card, no AI API.
- Roman Urdu explanations are fine; code and comments in English.
