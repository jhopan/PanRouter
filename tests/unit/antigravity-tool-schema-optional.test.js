import { describe, expect, it } from "vitest";
import {
  cleanJSONSchemaForAntigravity,
  UNSUPPORTED_SCHEMA_CONSTRAINTS,
} from "../../open-sse/translator/formats/gemini.js";

// Antigravity answers the WHOLE request with
//   400 INVALID_ARGUMENT: Unknown name "~optional": Cannot find field.
// when a tool schema carries `~optional` — a keyword that is not JSON Schema at
// all, but that MCP/agent tool schemas emit. One occurrence kills the turn, so
// it has to be stripped at every depth, like `optional` beside it.
describe("Antigravity tool schemas drop non-standard optional markers", () => {
  it("lists both optional spellings as unsupported", () => {
    expect(UNSUPPORTED_SCHEMA_CONSTRAINTS).toContain("optional");
    expect(UNSUPPORTED_SCHEMA_CONSTRAINTS).toContain("~optional");
  });

  it("strips ~optional from the root, nested properties and array items", () => {
    const schema = {
      type: "object",
      "~optional": true,
      properties: {
        name: { type: "string" },
        metadata: {
          type: "object",
          "~optional": true,
          properties: {
            tags: {
              type: "array",
              "~optional": true,
              items: {
                type: "object",
                "~optional": true,
                properties: { id: { type: "string", "~optional": true } },
              },
            },
          },
        },
      },
    };

    const out = cleanJSONSchemaForAntigravity(schema);
    const flat = JSON.stringify(out);

    expect(flat).not.toContain("~optional");
    // the real schema content survived the strip
    expect(out.properties.name).toBeDefined();
    expect(out.properties.metadata.properties.tags.items.properties.id).toBeDefined();
  });

  it("strips the plain optional marker the same way", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      optional: true,
      properties: {
        inner: { type: "string", optional: true },
      },
    });

    expect(JSON.stringify(out)).not.toContain("optional");
    expect(out.properties.inner).toBeDefined();
  });

  it("leaves an unrelated schema untouched", () => {
    const clean = {
      type: "object",
      properties: { id: { type: "string", description: "identifier" } },
      required: ["id"],
    };
    expect(cleanJSONSchemaForAntigravity(clean)).toEqual(clean);
  });
});
