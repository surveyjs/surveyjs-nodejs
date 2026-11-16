// POST /api/responses
import { httpError } from "../integration/http.js";
import { insertResponse } from "../integration/stored-json.js";

export default function saveResponse(app) {
  // #region sjs:save-response.server
  // POST /api/responses: Store submitted answers as one JSON document
  // express.json({ strict: false }) in app.js parses the raw body: {} stays {}, "  padded  " and "" stay as sent
  app.post("/api/responses", (req, res) => {
    const { formId, data } = req.body ?? {};
    if (formId == null || data == null) throw httpError(400, "Expected { formId, data }");

    const id = insertResponse(req, formId, data);   // JSON.stringify(data), never a copy of it
    res.status(201).json({ id });
  });
  // #endregion
}
