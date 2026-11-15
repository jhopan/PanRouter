/**
 * Zed 2-step import — helper contract.
 *
 * Covers the pure pieces ported from OmniRoute src/lib/zed-oauth/:
 *   - fingerprintZedCredential: stable per (service, account, token), changes
 *     when any component changes
 *   - partitionZedCredentials: skips unsupported/short tokens, drops duplicates
 *     and counts them
 *   - parseZedManualImportBody: parses a pasted native-app callback URL
 */

import { describe, it, expect } from "vitest";
import {
  fingerprintZedCredential,
  ZED_FINGERPRINT_LENGTH,
} from "../../src/lib/zed-oauth/credentialFingerprint.js";
import {
  partitionZedCredentials,
  zedCredentialSkipReason,
  MIN_ZED_TOKEN_LENGTH,
} from "../../src/lib/zed-oauth/importUtils.js";
import {
  filterCredentialsByConfirmation,
  isConfirmedAccount,
  parseConfirmedAccounts,
} from "../../src/lib/zed-oauth/confirmedAccounts.js";
import { parseZedManualImportBody } from "../../src/lib/zed-oauth/manualImport.js";

const credential = (overrides = {}) => ({
  provider: "zed",
  service: "https://zed.dev",
  account: "user-1",
  token: "zed-access-token-abcdef",
  ...overrides,
});

describe("fingerprintZedCredential", () => {
  it("is a stable 16-char hex digest of (service, account, token)", () => {
    const first = fingerprintZedCredential("https://zed.dev", "user-1", "token-abc");
    const second = fingerprintZedCredential("https://zed.dev", "user-1", "token-abc");

    expect(first).toBe(second);
    expect(first).toHaveLength(ZED_FINGERPRINT_LENGTH);
    expect(first).toMatch(/^[0-9a-f]+$/);
  });

  it("changes when the service, account or token changes", () => {
    const base = fingerprintZedCredential("https://zed.dev", "user-1", "token-abc");
    const otherService = fingerprintZedCredential("https://staging.zed.dev", "user-1", "token-abc");
    const otherAccount = fingerprintZedCredential("https://zed.dev", "user-2", "token-abc");
    const otherToken = fingerprintZedCredential("https://zed.dev", "user-1", "token-xyz");

    expect(otherService).not.toBe(base);
    expect(otherAccount).not.toBe(base);
    expect(otherToken).not.toBe(base);
  });

  it("does not leak the token", () => {
    const token = "super-secret-zed-token";
    expect(fingerprintZedCredential("https://zed.dev", "user-1", token)).not.toContain(token);
  });
});

describe("partitionZedCredentials", () => {
  it("keeps a supported, sufficiently long credential", () => {
    const { importable, skipped, duplicatesDropped } = partitionZedCredentials([credential()]);

    expect(importable).toHaveLength(1);
    expect(skipped).toHaveLength(0);
    expect(duplicatesDropped).toBe(0);
  });

  it("skips missing, short-token and unsupported-provider credentials with a reason", () => {
    const missingToken = credential({ token: "" });
    const shortToken = credential({ account: "user-2", token: "x".repeat(MIN_ZED_TOKEN_LENGTH - 1) });
    const unsupported = credential({ provider: "not-a-real-provider", account: "user-3" });

    const { importable, skipped } = partitionZedCredentials([
      credential(),
      missingToken,
      shortToken,
      unsupported,
    ]);

    expect(importable).toHaveLength(1);
    expect(skipped).toEqual([missingToken, shortToken, unsupported]);
    expect(zedCredentialSkipReason(missingToken)).toBe("missing token");
    expect(zedCredentialSkipReason(shortToken)).toBe("short token");
    expect(zedCredentialSkipReason(unsupported)).toBe("unsupported provider");
  });

  it("drops duplicate provider+token pairs and counts them", () => {
    const original = credential({ account: "user-1" });
    const duplicate = credential({ account: "user-1-copy" });
    const third = credential({ account: "user-1-copy-2" });

    const { importable, skipped, duplicatesDropped } = partitionZedCredentials([
      original,
      duplicate,
      third,
    ]);

    expect(importable).toEqual([original]);
    expect(skipped).toHaveLength(0);
    expect(duplicatesDropped).toBe(2);
  });

  it("keeps the same token under a different provider (dedupe key includes provider)", () => {
    const { importable, duplicatesDropped } = partitionZedCredentials([
      credential({ provider: "zed" }),
      credential({ provider: "openai" }),
    ]);

    expect(importable).toHaveLength(2);
    expect(duplicatesDropped).toBe(0);
  });

  it("tolerates non-array input", () => {
    expect(partitionZedCredentials(undefined)).toEqual({
      importable: [],
      skipped: [],
      duplicatesDropped: 0,
    });
  });
});

describe("confirmedAccounts", () => {
  it("accepts only well-formed entries", () => {
    expect(isConfirmedAccount({ service: "s", account: "a", fingerprint: "f" })).toBe(true);
    expect(isConfirmedAccount({ service: "", account: "a", fingerprint: "f" })).toBe(false);
    expect(isConfirmedAccount({ service: "s", account: "a" })).toBe(false);
    expect(isConfirmedAccount({ service: "s", account: "a", fingerprint: "x".repeat(101) })).toBe(false);
    expect(isConfirmedAccount(null)).toBe(false);
  });

  it("parses a body and rejects malformed shapes", () => {
    expect(parseConfirmedAccounts({ confirmedAccounts: [] })).toEqual([]);
    expect(parseConfirmedAccounts(null)).toBeNull();
    expect(parseConfirmedAccounts({ confirmedAccounts: "nope" })).toBeNull();
    expect(parseConfirmedAccounts({ confirmedAccounts: [{ service: "s" }] })).toBeNull();
  });

  it("matches credentials by the freshly recomputed fingerprint", () => {
    const current = credential();
    const fingerprint = fingerprintZedCredential(
      current.service,
      current.account,
      current.token,
    );
    const confirmed = [{ service: current.service, account: current.account, fingerprint }];

    expect(filterCredentialsByConfirmation([current], confirmed)).toEqual([current]);
    expect(
      filterCredentialsByConfirmation(
        [current],
        [{ ...confirmed[0], fingerprint: "0".repeat(ZED_FINGERPRINT_LENGTH) }],
      ),
    ).toEqual([]);
    expect(filterCredentialsByConfirmation([current], [])).toEqual([]);
  });
});

describe("parseZedManualImportBody", () => {
  it("parses a full native-app callback URL", () => {
    const parsed = parseZedManualImportBody({
      callbackUrl: "http://127.0.0.1:58443/?user_id=user-9&access_token=enc-token",
    });

    expect(parsed.userId).toBe("user-9");
    expect(parsed.encryptedAccessToken).toBe("enc-token");
    expect(parsed.codeVerifier).toBeNull();
    expect(parsed.state).toBeNull();
  });

  it("parses a JSON payload, a path+query string and a bare query string", () => {
    expect(
      parseZedManualImportBody({ callbackUrl: '{"user_id":"u2","access_token":"tok-2"}' }).userId,
    ).toBe("u2");
    expect(
      parseZedManualImportBody({ callbackUrl: "/callback?user_id=u3&access_token=tok-3" }).userId,
    ).toBe("u3");
    expect(
      parseZedManualImportBody({ code: "?user_id=u4&access_token=tok-4" }).userId,
    ).toBe("u4");
  });

  it("keeps optional fields and trims them", () => {
    const parsed = parseZedManualImportBody({
      callbackUrl: "http://127.0.0.1:58443/?user_id=u5&access_token=tok-5",
      codeVerifier: "  zed-rsa-pkcs1:abc  ",
      state: " state-1 ",
      systemId: " sys-1 ",
      name: " Laptop ",
    });

    expect(parsed.codeVerifier).toBe("zed-rsa-pkcs1:abc");
    expect(parsed.state).toBe("state-1");
    expect(parsed.systemId).toBe("sys-1");
    expect(parsed.name).toBe("Laptop");
  });

  it("rejects missing, unparsable and oversized input", () => {
    expect(() => parseZedManualImportBody({})).toThrow(/callbackUrl is required/);
    expect(() => parseZedManualImportBody({ callbackUrl: "not a url at all" })).toThrow(
      /Invalid Zed callback URL|must include/,
    );
    expect(() =>
      parseZedManualImportBody({ callbackUrl: "http://127.0.0.1/?user_id=u&access_token=t" , name: "x".repeat(129) }),
    ).toThrow(/exceeds/);
    expect(() => parseZedManualImportBody("nope")).toThrow(/JSON object/);
  });
});