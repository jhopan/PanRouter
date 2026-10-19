import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { resolveAwsCredentials } from "../../open-sse/shared/awsCredentials.js";

const raw = fs.readFileSync(
  path.resolve("../open-sse/shared/awsCredentials.js"),
  "utf8",
);

// Strip line comments and block comments so the explanatory prose in the module
// (which necessarily mentions the specifier) cannot satisfy or trip an
// assertion about the actual code.
const source = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

// @aws-sdk/credential-providers is an optional dependency. A literal dynamic
// import makes webpack resolve it at build time and fails the whole build when
// it is absent — and because executors/index.js pulls bedrock.js into every
// route, that took down /v1/models, /models and the root layout.
describe("Bedrock optional SDK dependency", () => {
  it("never writes a literal import() for the optional AWS SDK", () => {
    // Match an actual call, not the explanatory comment above it.
    const literalImport = /import\s*\(\s*["']@aws-sdk\/credential-providers["']\s*\)/;
    expect(literalImport.test(source)).toBe(false);
  });

  it("resolves the SDK through createRequire instead", () => {
    expect(source).toContain('createRequire(import.meta.url)');
    expect(source).toContain("requireOptional(AWS_CREDENTIAL_PROVIDERS_MODULE)");
  });

  it("keeps the module specifier in config, not inline", () => {
    // The specifier lives in awsConstants.js; duplicating it inline is what
    // made the bundler treat it as a required module.
    expect(source).toContain("AWS_CREDENTIAL_PROVIDERS_MODULE");
    expect(source).not.toMatch(/["']@aws-sdk\/credential-providers["']/);
  });

  it("still resolves static-key credentials with no SDK at all", async () => {
    // Static mode must not touch the SDK: this is the path every user without
    // the optional package takes.
    const loadCredentialProviders = vi.fn(() => {
      throw new Error("SDK must not be loaded for static credentials");
    });

    const resolved = await resolveAwsCredentials(
      {
        apiKey: "secret-access-key",
        providerSpecificData: { accessKeyId: "AKIAEXAMPLE", region: "us-east-1" },
      },
      { loadCredentialProviders },
    );

    expect(loadCredentialProviders).not.toHaveBeenCalled();
    expect(resolved.accessKeyId).toBe("AKIAEXAMPLE");
    expect(resolved.secretAccessKey).toBe("secret-access-key");
    expect(resolved.mode).toBe("static");
  });

  it("surfaces an actionable error when profile mode has no SDK", async () => {
    const loadCredentialProviders = () => {
      throw new Error("Cannot find module '@aws-sdk/credential-providers'");
    };

    await expect(
      resolveAwsCredentials(
        { providerSpecificData: { profile: "my-profile", region: "us-east-1" } },
        { loadCredentialProviders },
      ),
    ).rejects.toThrow(/@aws-sdk\/credential-providers package, which failed to load/);
  });
});
