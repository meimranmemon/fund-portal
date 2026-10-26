import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

console.log("========================================================");
console.log("  Starting Fund Investor Portal (Local + Cloud Tunnel)");
console.log("========================================================\n");

// 1. Start local Express server on port 8080
console.log("1. Starting local Express server on port 8080...");
const server = spawn("node", ["server.js"], {
  cwd: rootDir,
  stdio: ["ignore", "pipe", "pipe"],
});

server.stdout.pipe(process.stdout);
server.stderr.pipe(process.stderr);

let currentTunnelProcess = null;
let isDeploying = false;

async function requestTunnelCredentials(retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`2. Connecting to Cloudflare edge (Attempt ${attempt}/${retries})...`);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000); // 45s timeout for high-latency ISP routes
      const resp = await fetch("https://api.trycloudflare.com/tunnel", {
        method: "POST",
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        throw new Error(`Cloudflare API status ${resp.status}`);
      }

      const data = await resp.json();
      if (!data.success || !data.result) {
        throw new Error("Invalid response from trycloudflare API: " + JSON.stringify(data));
      }

      const res = data.result;
      const tokenObj = {
        a: res.account_tag,
        t: res.id,
        s: res.secret,
      };
      const token = Buffer.from(JSON.stringify(tokenObj)).toString("base64");
      const hostname = res.hostname;

      return { token, hostname };
    } catch (err) {
      console.warn(`Edge connection attempt ${attempt} notice: ${err.message}`);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  throw new Error("Could not acquire Cloudflare tunnel credentials after multiple attempts.");
}

async function startTunnel() {
  try {
    const { token, hostname } = await requestTunnelCredentials();
    const tunnelUrl = `https://${hostname}`;

    console.log("\n========================================================");
    console.log("  ✔ SECURE CLOUD TUNNEL ACTIVE (100% FREE - NO CARD)");
    console.log("  Tunnel URL: " + tunnelUrl);
    console.log("========================================================\n");

    // Update public/firebase-config.js
    const configPath = path.join(rootDir, "public", "firebase-config.js");
    let content = fs.readFileSync(configPath, "utf8");
    const inject = `window.CLOUD_API_URL = "${tunnelUrl}/api";\n`;

    if (content.includes("window.CLOUD_API_URL")) {
      content = content.replace(/window\.CLOUD_API_URL\s*=\s*"[^"]+";\n?/, inject);
    } else {
      content = inject + content;
    }
    fs.writeFileSync(configPath, content);
    console.log("✔ Updated firebase-config.js with live tunnel URL");

    // Sync to Firebase Hosting
    if (!isDeploying) {
      isDeploying = true;
      console.log("3. Syncing to Firebase Hosting (https://fund-investor-portal.web.app)...");
      try {
        execSync("firebase deploy --only hosting", {
          cwd: rootDir,
          env: { ...process.env, CI: "true" },
          stdio: "inherit",
        });
        console.log("\n========================================================");
        console.log("  🎉 PORTAL IS LIVE ON BOTH LOCAL & INTERNET!");
        console.log("========================================================");
        console.log("  📱 Mobile / Internet URL: https://fund-investor-portal.web.app");
        console.log("  💻 Local PC URL:          http://localhost:8080");
        console.log("========================================================");
        console.log("  Keep this window open while using the app.");
        console.log("  Press Ctrl+C to stop.");
      } catch (err) {
        console.warn("Firebase deploy notice:", err.message);
      } finally {
        isDeploying = false;
      }
    }

    // Launch cloudflared with the token
    const cloudflared = spawn(
      path.join(rootDir, "cloudflared.exe"),
      ["tunnel", "--url", "http://localhost:8080", "run", "--token", token],
      { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] }
    );
    currentTunnelProcess = cloudflared;

    cloudflared.stderr.on("data", (d) => {
      const line = d.toString();
      if (line.includes("Registered tunnel connection") || line.includes("ERR") || line.includes("FTL")) {
        process.stderr.write(line);
      }
    });

    cloudflared.on("close", (code) => {
      console.log(`\nTunnel process closed (code ${code}). Re-establishing tunnel in 3s...`);
      currentTunnelProcess = null;
      setTimeout(startTunnel, 3000);
    });

    cloudflared.on("error", (err) => {
      console.error("Cloudflared process error:", err.message);
    });
  } catch (err) {
    console.error("Failed to start tunnel:", err.message);
    console.log("Retrying in 5 seconds...");
    setTimeout(startTunnel, 5000);
  }
}

// Start tunnel after server starts
setTimeout(startTunnel, 1500);

process.on("SIGINT", () => {
  console.log("\nStopping server and tunnel...");
  if (server) server.kill();
  if (currentTunnelProcess) currentTunnelProcess.kill();
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (server) server.kill();
  if (currentTunnelProcess) currentTunnelProcess.kill();
  process.exit(0);
});
