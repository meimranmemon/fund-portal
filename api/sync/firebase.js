import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

export const access = "user";
export const methods = ["POST"];

export default async function (req, res) {
  try {
    // Run firebase deploy --only hosting from project root
    const firebaseBin = "firebase";
    const { stdout, stderr } = await execAsync(
      `${firebaseBin} deploy --only hosting`,
      {
        cwd: rootDir,
        timeout: 60000,
        env: { ...process.env, CI: "true" },
      }
    );
    const output = stdout + stderr;
    const success = output.includes("Deploy complete") || output.includes("release complete");
    const url = (output.match(/Hosting URL:\s*(\S+)/) || [])[1] || "https://fund-investor-portal.web.app";
    console.log("Firebase sync:", success ? "OK" : "FAILED", output.slice(-300));
    return res.json({ success, url, output: output.slice(-500) });
  } catch (err) {
    console.error("Firebase sync error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
