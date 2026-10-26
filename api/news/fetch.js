import { refreshNews } from "../../lib/newsStore.js";

export const access = "user";
export const methods = ["POST"];

export default async function (req, res) {
  const r = await refreshNews();
  res.json(r);
}