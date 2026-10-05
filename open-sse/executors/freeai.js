import { DefaultExecutor } from "./default.js";

/**
 * FreeAIExecutor — Free.ai unified node.
 *
 * Free.ai splits its endpoints by model family:
 *   - chat/code  → /v1/chat/           (native path)
 *   - vision     → /v1/chat/completions (OpenAI-compatible path)
 *
 * One provider id ("freeai"), one API key, both endpoint sets. The base URL in
 * the registry stays at /v1/chat/ (chat default); this executor switches to the
 * OpenAI-completions path for vision models so users do not need a second
 * connection ("freeai-vl").
 */

const FREEAI_CHAT_BASE = "https://api.free.ai/v1/chat/";
const FREEAI_VISION_BASE = "https://api.free.ai/v1/chat/completions";

const FREEAI_VISION_MODELS = new Set([
  "qwen-vl",
  "qwen25-vl",
  "moondream2",
]);

export class FreeAIExecutor extends DefaultExecutor {
  constructor() {
    super("freeai");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // Honour a credential-level runtime transport override when present.
    if (credentials?.runtimeTransport?.baseUrl) {
      return super.buildUrl(model, stream, urlIndex, credentials);
    }
    const cleanModel = String(model || "").split("/").pop();
    return FREEAI_VISION_MODELS.has(cleanModel)
      ? FREEAI_VISION_BASE
      : FREEAI_CHAT_BASE;
  }
}

export default FreeAIExecutor;