import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function getJsFiles(dir) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

async function testAll() {
  console.log("=== Verifying all API & LIB modules ===");
  const targets = [
    ...getJsFiles(path.join(rootDir, "lib")),
    ...getJsFiles(path.join(rootDir, "api")),
  ];

  let passed = 0;
  let failed = 0;

  for (const file of targets) {
    const rel = path.relative(rootDir, file);
    try {
      const url = pathToFileURL(file).href;
      await import(url);
      console.log(`[OK] ${rel}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${rel}:`, err.message);
      failed++;
    }
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

testAll();
