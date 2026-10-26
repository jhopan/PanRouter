/**
 * Provider alias -> provider id, built from the registry.
 *
 * Why this file exists: `checkFallbackError` matches provider-scoped rules by
 * id ("codebuddy-intl"), but requests arrive carrying the ALIAS ("cbai"). The
 * registry is the single source of truth for both, so the map is derived from
 * it here instead of hardcoding aliases or reaching back into src/ — open-sse
 * must not grow a new coupling to src/ (see open-sse/AGENTS.md).
 *
 * The map is built once at module load from the same registry that provides
 * the providers, so a new alias in a registry file is picked up automatically.
 */

import REGISTRY from "../providers/registry/index.js";

/** alias (and secondary aliases) -> provider id */
const ALIAS_TO_ID = new Map();

for (const entry of REGISTRY) {
  if (!entry?.id) continue;
  if (entry.alias) ALIAS_TO_ID.set(entry.alias, entry.id);
  for (const extra of entry.aliases || []) ALIAS_TO_ID.set(extra, entry.id);
}

/**
 * Resolve an alias or id to the canonical provider id.
 * @param {string|null|undefined} aliasOrId
 * @returns {string|null|undefined} the provider id, or the input unchanged
 */
export function resolveProviderIdFromRegistry(aliasOrId) {
  if (!aliasOrId) return aliasOrId;
  return ALIAS_TO_ID.get(aliasOrId) || aliasOrId;
}
