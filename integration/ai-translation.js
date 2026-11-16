// Asks any OpenAI-compatible /chat/completions endpoint (AI_BASE_URL, AI_API_KEY, AI_MODEL) to translate Creator's
// strings. Your provider and your key: nothing goes to SurveyJS. Swap this file for your provider's SDK if you like;
// the route only needs an array back. When you copy ai-translation, copy this file too.
import { fetchWithTimeout, httpError } from "./http.js";

export const aiTranslation = {
  /**
   * The translated strings as the model returned them (an array if all went well), or null. An unreachable
   * provider or an HTTP error ends the request here with 502.
   * @param {{ baseUrl: string, apiKey: string, model: string }} ai config.ai
   */
  async translate(ai, strings, from, to) {
    let reply;
    try {
      const response = await fetchWithTimeout(`${ai.baseUrl}/chat/completions`, {
        timeout: 60_000,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ai.apiKey}` },
        body: JSON.stringify({
          model: ai.model,
          messages: [
            { role: "system", content: `Translate each string from ${from} to ${to}. Return a JSON array in the same order.` },
            { role: "user", content: JSON.stringify(strings) },
          ],
        }),
      });
      reply = await response.json().catch(() => null);
    } catch (error) {
      console.error(`Translation provider: ${error.message}`);
      throw httpError(502, "The translation provider is unavailable. Please try again.");
    }

    // Models sometimes wrap the array in prose or a code fence: take the array itself
    const content = reply?.choices?.[0]?.message?.content;
    const array = typeof content === "string" ? /\[.*\]/s.exec(content)?.[0] : undefined;
    try {
      return JSON.parse(array ?? "null");
    } catch {
      return null;
    }
  },
};
