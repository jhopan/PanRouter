// Qoder error classification + validation.
//
// 10605 with {"isQueued": true} is the ADMISSION QUEUE ("model is busy"), which
// clears in seconds. It used to be classified as a billing block, parking the
// account until the monthly reset for what is really a transient wait.
//
// Validation also stopped fetching the live model catalog: that call returns
// 10605 when the model is busy, making a valid key look invalid. The registry
// model list is static, so a credential exchange is enough.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

const executor = read("../open-sse/executors/qoder.js");
const validate = read("../src/app/api/providers/validate/route.js");

describe("qoder — 10605 queue is not a billing block", () => {
  it("explicitly returns false for the isQueued flag", () => {
    expect(executor).toMatch(/"isQueued"\\s\*:\\s\*true/i);
  });

  it("does not treat 10605 as billing", () => {
    // The numeric-code branch must bail out on 10605 before the billing codes.
    expect(executor).toMatch(/code === "10605"\) return false/);
  });

  it("keeps 110 and 112 as real billing blocks", () => {
    expect(executor).toMatch(/code === "110" \|\| code === "112"\) return true/);
  });

  it("no longer lists 10605 in the legacy regex", () => {
    expect(executor).not.toMatch(/"code"\\s\*:\\s\*"\(112\|10605\)"/);
  });
});

describe("qoder — validation does not fetch the model catalog", () => {
  it("does not call resolveQoderModels", () => {
    // Strip comments before asserting so the explanatory note is ignored.
    const code = validate
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toContain("resolveQoderModels(");
  });

  it("no longer imports resolveQoderModels", () => {
    expect(validate).toContain('import { resolveQoderCredentials } from "open-sse/services/qoderModels.js"');
  });

  it("validates on the credential exchange instead", () => {
    expect(validate).toMatch(/isValid = !!resolved\?\.accessToken/);
  });
});
