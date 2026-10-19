import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const source = fs.readFileSync(
  path.resolve("../src/app/api/providers/[id]/test/testUtils.js"),
  "utf8"
);

describe("CodeBuddy Intl provider test", () => {
  it("uses the same token-exists validation as CodeBuddy CN", () => {
    expect(source).toMatch(/"codebuddy-cn"\s*:\s*\{\s*tokenExists\s*:\s*true\s*\}/);
    expect(source).toMatch(/"codebuddy-intl"\s*:\s*\{\s*tokenExists\s*:\s*true\s*\}/);
  });
});
