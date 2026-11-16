// Demo only: adds X-Demo-Cache: hit / miss / fallback to GET /api/countries, so the requests log shows where the
// list came from. It looks at the cache before the route runs and at the answer after, so routes/choices-from-web.js
// stays as the docs show it. "fallback" wins whenever the bundled list is served, also while it is cached.
import { readFileSync } from "node:fs";
import { cache } from "../integration/cache.js";

const bundled = JSON.stringify(JSON.parse(readFileSync(new URL("../shared/seed/countries.json", import.meta.url), "utf8")));

export function demoCacheHeader(req, res, next) {
  const cached = cache.has("countries");
  const json = res.json.bind(res);
  res.json = (body) => {
    res.set("X-Demo-Cache", JSON.stringify(body) === bundled ? "fallback" : cached ? "hit" : "miss");
    return json(body);
  };
  next();
}
