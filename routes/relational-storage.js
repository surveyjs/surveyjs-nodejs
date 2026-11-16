// POST /api/claims
import { db, transaction } from "../db.js";
import { httpError } from "../integration/http.js";
import { insertResponse } from "../integration/stored-json.js";

export default function relationalStorage(app) {
  // #region sjs:relational-storage.server
  // POST /api/claims — original JSON first, then the columns you query
  app.post("/api/claims", (req, res) => {
    const { data, definitionVersion } = req.body ?? {};   // the parsed raw body: {} stays {}
    if (data == null || definitionVersion == null) throw httpError(400, "Expected { data, definitionVersion }");

    const id = transaction(db(req), () => {
      const responseId = insertResponse(req, "claim", data, definitionVersion);   // the original and its version
      db(req).prepare("INSERT INTO claims (response_id, customer_email, amount) VALUES (?, ?, ?)")
        .run(responseId, data.customer_email ?? null, data.amount ?? null);       // keys come from valueName
      return responseId;
    });
    res.status(201).json({ id });
  });
  // #endregion
}
