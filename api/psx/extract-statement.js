import { parseStatementWithAI } from "../../lib/psxImport.js";

export const access = "user";
export const methods = ["POST"];

const MAX_BYTES = 15 * 1024 * 1024;

export default async function (req, res) {
  const file = (req.files || []).find(f => f.field === "file");
  if (!file) return res.status(400).json({ error: "No PDF file received." });
  if (file.buffer.length > MAX_BYTES) return res.status(413).json({ error: "PDF too large (max 15 MB)." });
  if (file.contentType !== "application/pdf" && !file.filename?.toLowerCase().endsWith(".pdf")) {
    return res.status(415).json({ error: "Please upload a PDF file." });
  }

  try {
    const rows = await parseStatementWithAI(file.buffer.toString("base64"));
    if (!rows.length) {
      return res.status(422).json({ error: "No trade rows could be identified in this PDF. Try a clearer export." });
    }
    res.json({ rows, count: rows.length });
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes("no Anthropic") || msg.includes("no OpenAI") || msg.includes("no Google") || msg.includes("API key")) {
      return res.status(412).json({ error: "AI extraction isn't set up yet for this app. The project owner needs to add an AI provider key (or enable Builder + AI) in console Settings first.", setup_required: true });
    }
    res.status(500).json({ error: msg });
  }
}