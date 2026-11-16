// GET /claim, GET /api/forms/:id
import { readFileSync } from "node:fs";
import { db } from "../db.js";
import { httpError } from "../integration/http.js";

export default function loadDefinitionVariablesData(app) {
  // #region sjs:load-definition-variables-data.server
  // Option A: Embed the schema and user variables in the HTML response
  app.get("/claim", (req, res) => {
    const file = new URL("../shared/definitions/load-definition-variables-data.json", import.meta.url);
    const definition = JSON.parse(readFileSync(file, "utf8"));
    const variables = { user: { name: req.user?.name ?? null, plan: req.user?.plan ?? null } };
    res.render("examples/load-definition-variables-data", { definition, variables });   // the view escapes both
  });

  // Option B: Return the definition, variables, and previous answers in one response
  app.get("/api/forms/:id", (req, res) => {
    const form = db(req).prepare("SELECT json FROM forms WHERE key = ?").get(req.params.id);
    if (!form) throw httpError(404, "Unknown form");
    const record = typeof req.query.record === "string" ? req.query.record : "";
    const saved = req.params.id === "claim-request"   // only the signed-in customer's own claims
      ? db(req).prepare("SELECT data FROM responses WHERE id = ? AND form_id = 'claim' AND data ->> 'customer_email' = ?")
        .get(record, req.user?.email ?? "")
      : db(req).prepare("SELECT data FROM responses WHERE id = ?").get(record);

    res.json({
      definition: JSON.parse(form.json),                                // the stored form definition
      variables: { user: { name: req.user?.name ?? null, plan: req.user?.plan ?? null } },
      data: saved ? JSON.parse(saved.data) : {},                       // previous answers, or {} when there are none
    });
  });
  // #endregion
}
