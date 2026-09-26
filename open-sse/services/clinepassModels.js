import { buildClineHeaders } from "../shared/clineAuth.js";

const CLINEPASS_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/models";
// Cline's free tier is published here, not in /api/v1/models: the catalog
// endpoint carries no `cline-free/*` ids at all. Cline's own SDK calls this
// feed unauthenticated (sdk/packages/core/src/services/llms/cline-recommended-models.ts),
// so no Authorization header is sent — adding one would only make the request
// fail on a header the endpoint ignores.
const CLINE_RECOMMENDED_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/ai/cline/recommended-models";
const FETCH_TIMEOUT_MS = 5000;

/**
 * Build request headers for Cline's model-list endpoints.
 * Auth shape lives in shared/clineAuth: API keys ride plain Bearer, OAuth
 * access tokens carry the WorkOS `workos:` prefix.
 */
function buildModelListHeaders(token, isApiKey) {
  return buildClineHeaders(token, { Accept: "application/json" }, { isApiKey });
}

/**
 * Internal: fetch the tiered model catalog. Returns the parsed object
 * (`{ recommended, free, clinePass, clineCloud }`) or null on any failure.
 * @returns {Promise<{recommended?: object[], free?: object[], clinePass?: object[], clineCloud?: object[]} | null>}
 */
async function fetchClineCatalog(credentials) {
  const isApiKey = Boolean(credentials?.apiKey);
  const token = isApiKey ? credentials.apiKey : credentials?.accessToken;
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers = buildModelListHeaders(token, isApiKey);

    const response = await fetch(CLINE_RECOMMENDED_MODELS_ENDPOINT, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const json = await response.json();
    return json && typeof json === "object" ? json : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalize one catalog group into `{ models: [{ id, name }] }`, or null when
 * the group is missing/empty (caller then falls back to the static registry).
 */
function toModels(group) {
  if (!Array.isArray(group)) return null;
  const models = group
    .filter((m) => typeof m?.id === "string" && m.id.trim() !== "")
    .map((m) => ({ id: m.id, name: m.name || m.id }));
  return models.length ? { models } : null;
}

/**
 * Fetch Cline's recommended-models feed and return only its `free[]` tier.
 * Returns null on any failure — the free tier is additive, so a dead feed must
 * never take the /api/v1/models catalog down with it.
 * @param {{accessToken?: string, apiKey?: string}} credentials
 * @returns {Promise<{id: string, name: string}[] | null>}
 */
async function fetchClineFreeTierModels() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(CLINE_RECOMMENDED_MODELS_ENDPOINT, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const json = await response.json();
    const free = Array.isArray(json?.free) ? json.free : [];
    if (!free.length) return null;

    return free
      .filter((m) => typeof m?.id === "string" && m.id.trim() !== "")
      .map((m) => ({ id: m.id, name: m.name || m.id }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch Cline live model catalog from Cline's /models endpoint.
 * Unlike resolveClinepassModels, this returns ALL models (including
 * free-tier models like z-ai/glm-5.3-flash) without the cline-pass/ prefix filter.
 *
 * @param {object} credentials - Connection credentials ({ accessToken, apiKey })
 * @returns {Promise<{ models: { id: string, name: string }[] } | null>}
 */
export async function resolveClineModels(credentials) {
  const catalog = await fetchClineCatalog(credentials);
  if (!catalog) return null;
  return toModels(catalog.free);
}

  const models = rawList
    .filter((m) => typeof m?.id === "string" && m.id.trim() !== "")
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
    }));

  // Free tier: /api/v1/models lists no `cline-free/*` ids, so merge the feed's
  // free[] in. First writer wins on a shared id, keeping the catalog's entry
  // for anything the two sources agree on.
  const freeTier = await fetchClineFreeTierModels();
  const byId = new Map(models.map((m) => [m.id, m]));
  for (const m of freeTier || []) {
    if (!byId.has(m.id)) byId.set(m.id, m);
  }
  const merged = Array.from(byId.values());

  return merged.length ? { models: merged } : null;
}
