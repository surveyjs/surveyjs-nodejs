// The AI provider for extract-from-paper, chosen as SurveyJS Server's src/provider.ts chooses it: SURVEYJS_AI_PROVIDER
// (openai, anthropic or ollama), or else the provider whose API key is set, with SURVEYJS_AI_MODEL or the provider's
// default model. The app's AI_MODEL belongs to ai-translation, hence the SURVEYJS_ prefix.
import { anthropic, ollama, openai } from "ai-form-response-extractor/providers";

/** No provider is configured: none chosen, an unknown one, or its key missing. The route answers 503. */
export class AiConfigurationError extends Error {}

// The openai and anthropic providers read their key from process.env themselves; ollama needs none
const providers = {
  openai: { factory: openai, key: "openaiApiKey", variable: "OPENAI_API_KEY" },
  anthropic: { factory: anthropic, key: "anthropicApiKey", variable: "ANTHROPIC_API_KEY" },
  ollama: { factory: ollama },
};

export const aiProvider = {
  /**
   * The extractor's provider for config.extraction, or AiConfigurationError.
   * @param {{ provider: string|null, model: string|null, ollamaBaseUrl: string|null, openaiApiKey: string|null, anthropicApiKey: string|null }} extraction
   */
  create(extraction) {
    const name = extraction.provider?.toLowerCase()
      ?? Object.keys(providers).find((key) => providers[key].key && extraction[providers[key].key]);
    if (!name) throw new AiConfigurationError("No AI provider: set SURVEYJS_AI_PROVIDER or OPENAI_API_KEY / ANTHROPIC_API_KEY");
    const info = providers[name];
    if (!info) throw new AiConfigurationError(`Unknown SURVEYJS_AI_PROVIDER "${name}" (openai, anthropic or ollama)`);
    if (info.key && !extraction[info.key]) throw new AiConfigurationError(`${info.variable} is not set`);

    // The extractor's ollama provider has no base-URL option: it reads process.env.OLLAMA_BASE_URL on every call.
    // This is the one place outside config.js that touches process.env.
    if (name === "ollama" && extraction.ollamaBaseUrl) process.env.OLLAMA_BASE_URL = extraction.ollamaBaseUrl;

    return extraction.model ? info.factory(extraction.model) : info.factory();
  },
};
