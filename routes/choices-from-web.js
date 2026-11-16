// GET /api/offices, GET /api/countries
import { readFileSync } from "node:fs";
import { db } from "../db.js";
import { cache } from "../integration/cache.js";
import { fetchWithTimeout } from "../integration/http.js";

const bundledCountries = JSON.parse(readFileSync(new URL("../shared/seed/countries.json", import.meta.url), "utf8"));
const DAY = 24 * 60 * 60 * 1000;

export default function choicesFromWeb(app) {
  // #region sjs:choices-from-web.server
  // GET /api/offices?region= — {region} from the form arrives as a query parameter
  app.get("/api/offices", (req, res) => {
    const region = typeof req.query.region === "string" ? req.query.region : "";   // ?region=a&region=b is an array
    res.json(db(req).prepare("SELECT id, name FROM offices WHERE region = ? ORDER BY name").all(region));
  });

  // GET /api/countries — a proxy: the browser can't call a service without CORS, your server can
  app.get("/api/countries", async (req, res) => {
    let countries = cache.get("countries");
    if (!countries) {
      try {
        const response = await fetchWithTimeout("https://restcountries.com/v3.1/all?fields=name,cca2", { timeout: 5000 });
        countries = (await response.json()).map((country) => ({ code: country.cca2, name: country.name.common }))
          .sort((a, b) => a.name.localeCompare(b.name));
        cache.set("countries", countries, DAY);
      } catch (error) {   // down, or a different answer: serve the bundled list for 10 minutes, not a timeout per request
        console.warn(`restcountries.com failed (${error.message}); serving shared/seed/countries.json`);
        countries = bundledCountries;
        cache.set("countries", countries, 10 * 60 * 1000);
      }
    }
    res.set("Cache-Control", "public, max-age=86400").json(countries);
  });
  // #endregion
}
