// GET /api/customers/exists, GET /api/shipping
import { db } from "../db.js";

export default function asyncFunctions(app) {
  // #region sjs:async-functions.server
  // GET /api/customers/exists?email= — answers emailExists()
  app.get("/api/customers/exists", (req, res) => {
    const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";
    const customer = db(req).prepare("SELECT email FROM customers WHERE email = ?").get(email);

    res.json({ exists: customer !== undefined });
  });

  // GET /api/shipping?postcode= — answers shippingCost(): the longest matching postcode prefix wins,
  // { "price": null } when none matches (the form shows "We don't deliver to this postcode yet")
  app.get("/api/shipping", (req, res) => {
    const postcode = typeof req.query.postcode === "string" ? req.query.postcode.replaceAll(" ", "").toUpperCase() : "";
    // only a whole German (10115) or UK (SW1A 1AA) postcode gets a price, not anything that starts with a prefix
    if (!/^(\d{5}|[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2})$/.test(postcode)) return res.json({ price: null });
    const rate = db(req).prepare(`SELECT price FROM shipping_rates WHERE substr(?, 1, length(postcode_prefix)) = postcode_prefix
      ORDER BY length(postcode_prefix) DESC LIMIT 1`).get(postcode);

    res.json({ price: rate?.price ?? null });
  });
  // #endregion
}
