import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

// Google Cloud Code parks an Antigravity account for good when it trips the TOS
// or asks for re-validation. The generic 403 cooldown is 2 minutes, which means
// the router retried a suspended account every 2 minutes forever — upstream
// 9router PR #5688 turns those two bodies into a 24-hour account lock.
const DAY_MS = 24 * 60 * 60 * 1000;
const GENERIC_403_MS = 2 * 60 * 1000;

const TOS_BODY =
  "PERMISSION_DENIED TOS_VIOLATION: This service has been disabled in this account for violation of Terms of Service";
const VALIDATION_BODY =
  "PERMISSION_DENIED VALIDATION_REQUIRED: Validation is required for this account";

describe("Antigravity TOS violation and validation backoff", () => {
  it.each([TOS_BODY, "tos_violation"])("sets a 24h cooldown for %s under antigravity", (msg) => {
    expect(checkFallbackError(403, msg, 0, "antigravity")).toMatchObject({
      shouldFallback: true,
      cooldownMs: DAY_MS,
    });
  });

  // `ag` is a registry alias: the matcher resolves it to `antigravity` before
  // comparing rule.provider, so the alias needs no duplicate rule of its own.
  it.each([TOS_BODY, "tos_violation"])("sets a 24h cooldown for %s under the ag alias", (msg) => {
    expect(checkFallbackError(403, msg, 0, "ag")).toMatchObject({
      shouldFallback: true,
      cooldownMs: DAY_MS,
    });
  });

  it.each([VALIDATION_BODY, "validation_required"])(
    "sets a 24h cooldown for %s under antigravity",
    (msg) => {
      expect(checkFallbackError(403, msg, 0, "antigravity")).toMatchObject({
        shouldFallback: true,
        cooldownMs: DAY_MS,
      });
    },
  );

  it.each([VALIDATION_BODY, "validation_required"])(
    "sets a 24h cooldown for %s under the ag alias",
    (msg) => {
      expect(checkFallbackError(403, msg, 0, "ag")).toMatchObject({
        shouldFallback: true,
        cooldownMs: DAY_MS,
      });
    },
  );

  it("does not extend the cooldown for other providers on the same body", () => {
    expect(checkFallbackError(403, TOS_BODY, 0, "openai")).toMatchObject({
      shouldFallback: true,
      cooldownMs: GENERIC_403_MS,
    });
    expect(checkFallbackError(403, VALIDATION_BODY, 0, "openai")).toMatchObject({
      shouldFallback: true,
      cooldownMs: GENERIC_403_MS,
    });
  });

  it("keeps the 2-minute cooldown for a generic Antigravity 403", () => {
    expect(checkFallbackError(403, "Forbidden", 0, "antigravity")).toMatchObject({
      shouldFallback: true,
      cooldownMs: GENERIC_403_MS,
    });
  });

  it("does not lock the account when no provider is supplied", () => {
    // Provider-scoped rules must not leak into the provider-less matcher.
    expect(checkFallbackError(403, TOS_BODY, 0, null)).toMatchObject({
      shouldFallback: true,
      cooldownMs: GENERIC_403_MS,
    });
  });
});