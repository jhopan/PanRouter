// Ollama Local embeddings — one local server, any embedding model pulled into it.
// The chat transport targets /api/chat (Ollama's native route), but embeddings are
// served OpenAI-compatibly at /v1/embeddings, so this adapter always builds that
// path from the resolved host instead of reusing transport.baseUrl.
import { resolveOllamaLocalHost } from "../../config/providers.js";

export default {
  buildUrl: (_model, creds) => {
    const rawHost = resolveOllamaLocalHost(creds);
    // Tolerate a saved host that already includes the OpenAI base or the full
    // embeddings path — otherwise the user's value would be appended twice.
    const host = String(rawHost || "")
      .replace(/\/+$/, "")
      .replace(/\/v1\/embeddings$/, "")
      .replace(/\/v1$/, "");
    return `${host}/v1/embeddings`;
  },
  buildHeaders: (creds) => {
    // A stock Ollama ignores auth, but a proxy in front of it may require it.
    const headers = {
      "Content-Type": "application/json",
    };
    if (creds?.apiKey) {
      headers["Authorization"] = `Bearer ${creds.apiKey}`;
    }
    return headers;
  },
  buildBody: (model, { input, encoding_format, dimensions }) => {
    const body = { model, input };
    if (encoding_format) body.encoding_format = encoding_format;
    // Only forward a usable positive number: Ollama rejects a non-numeric or
    // zero dimensions value, and the OpenAI SDK sends `dimensions: null`.
    if (dimensions != null && dimensions !== "") {
      const dim = Number(dimensions);
      if (Number.isFinite(dim) && dim > 0) body.dimensions = dim;
    }
    return body;
  },
  normalize: (responseBody) => responseBody,
};