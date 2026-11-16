// POST /api/translate
import { aiTranslation } from "../integration/ai-translation.js";
import { httpError } from "../integration/http.js";

export default function aiTranslationRoutes(app) {
  // #region sjs:ai-translation.server
  // POST /api/translate — strings in, translated strings out (same order); nothing goes to SurveyJS
  app.post("/api/translate", async (req, res) => {
    const { ai } = req.app.locals.config;
    if (!ai.apiKey) throw httpError(501, "Set AI_API_KEY to enable translation");
    const { strings, from = "", to = "" } = req.body ?? {};
    if (!Array.isArray(strings)) throw httpError(400, "Expected { strings, from, to }");

    const translated = await aiTranslation.translate(ai, strings, from, to);   // any OpenAI-compatible provider
    if (!Array.isArray(translated) || translated.length !== strings.length || !translated.every((s) => typeof s === "string")) {
      throw httpError(502, "The AI provider returned an unexpected answer");
    }
    res.json(translated);   // what options.callback() takes
  });
  // #endregion
}
