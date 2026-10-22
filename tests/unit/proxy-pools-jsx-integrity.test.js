// Guard against the JSX breakage that shipped when the relay-variant dropdown
// was removed: the wrapper <div> was deleted but its closing tag was left
// behind, and `next build` failed with "Expected '</', got 'ident'".
//
// A plain string-based tag count catches that class of edit before build time.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const PAGE = "../src/app/(dashboard)/dashboard/proxy-pools/page.js";

const source = fs.readFileSync(path.resolve(PAGE), "utf8");

/** Count JSX opening and closing <div> tags, ignoring strings/comments. */
function countDivTags(src) {
  // Strip line comments and block comments first.
  const clean = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  const opens = (clean.match(/<div\b/g) || []).length;
  const selfClosing = (clean.match(/<div\b[^>]*\/>/g) || []).length;
  const closes = (clean.match(/<\/div>/g) || []).length;
  return { opens, selfClosing, closes };
}

describe("proxy-pools page — JSX integrity", () => {
  it("has balanced <div> tags", () => {
    const { opens, selfClosing, closes } = countDivTags(source);
    // A self-closing <div /> counts as both an open and a close in the raw
    // counts, so it must be subtracted from the open side.
    expect(opens - selfClosing).toBe(closes);
  });

  it("every JSX block opened in the netlify modal is closed", () => {
    const start = source.indexOf('title={netlifyDeployResult ? "Netlify Relay Ready"');
    const end = source.indexOf("</Modal>", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const modal = source.slice(start, end);
    const opens = (modal.match(/<div\b(?![^>]*\/>)/g) || []).length;
    const closes = (modal.match(/<\/div>/g) || []).length;
    expect(opens).toBe(closes);
  });
});
