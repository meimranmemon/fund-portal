import { runForOwner } from "../../lib/calcEngine.js";

export const access = "user";
export const methods = ["POST"];

export default async function (req, res) {
  const results = await runForOwner(req.user.id);
  res.json(results);
}