export const access = "user";
export const methods = ["GET"];

// Downloadable CSV template - opens/edits/saves fine in Excel, no AI or library needed.
export default async function (req, res) {
  const lines = [
    "Ticker,Trade Date (YYYY-MM-DD),Buy Qty,Sell Qty,Rate,Commission,Other Charges",
    "# One row = ONE trade leg. For a BUY: fill Buy Qty, leave Sell Qty as 0. For a SELL: fill Sell Qty, leave Buy Qty as 0.",
    "# Commission / Other Charges are optional - leave 0 and the app will calculate them from your Settings (brokerage slab + govt tax + CGT).",
    "# Delete these three '#' instruction lines and the two example rows below before uploading, or just add your real rows above them - the app ignores '#' lines automatically.",
    "OGDC,2026-09-01,1000,0,100,0,0",
    "OGDC,2026-09-15,0,400,130,0,0",
  ];
  const csv = lines.join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="psx_trade_import_template.csv"');
  res.send(csv);
}