import { describe, expect, it } from "vitest";
import {
  cleanJSONSchemaForAntigravity,
  convertOpenAIContentToParts,
} from "../../open-sse/translator/formats/gemini.js";
import { normalizeCodexTools } from "../../open-sse/executors/codex.js";

// Ported from upstream 09f6d395, 7ba1d1ca and 0dd4d6be.

describe("Gemini schema: a parameter named \"properties\"", () => {
  // ensureObjectType() used to walk into the properties MAP as if it were a
  // schema node, so the map itself got `type: "object"` — which reaches Gemini as
  // a bogus parameter named "type".
  it("does not inject a bogus type parameter into the properties map", () => {
    const schema = {
      type: "object",
      properties: {
        properties: { type: "string", description: "a parameter literally named properties" },
        other: { type: "string" },
      },
    };

    const out = cleanJSONSchemaForAntigravity(schema);

    expect(Object.keys(out.properties).sort()).toEqual(["other", "properties"]);
    expect(out.properties).not.toHaveProperty("type");
    expect(out.properties.properties.type).toBe("string");
  });
});

describe("Gemini remote images get a concrete MIME type", () => {
  // Gemini rejects the placeholder `image/*`.
  it("derives image/jpeg from the URL path and keeps the query string", () => {
    const url = "https://files.example.com/reference/photo.jpg?token=abc";
    expect(convertOpenAIContentToParts([{ type: "image_url", image_url: { url } }])).toEqual([
      { fileData: { fileUri: url, mimeType: "image/jpeg" } },
    ]);
  });

  it("maps the other known extensions", () => {
    const mime = (u) => convertOpenAIContentToParts([{ type: "image_url", image_url: { url: u } }])[0].fileData.mimeType;
    expect(mime("https://x/a.webp")).toBe("image/webp");
    expect(mime("https://x/a.gif")).toBe("image/gif");
    expect(mime("https://x/a.bmp")).toBe("image/bmp");
    expect(mime("https://x/a.png")).not.toBe("image/*");
  });

  it("never emits the image/* placeholder", () => {
    // An unknown extension falls back to the shared default, and a value that is
    // not a URL at all produces no part rather than a bogus one.
    const parts = convertOpenAIContentToParts([{ type: "image_url", image_url: { url: "https://x/unknown-format" } }]);
    expect(parts).toEqual([{ fileData: { fileUri: "https://x/unknown-format", mimeType: "image/png" } }]);
    expect(JSON.stringify(parts)).not.toContain("image/*");

    expect(convertOpenAIContentToParts([{ type: "image_url", image_url: { url: "not a url" } }])).toEqual([]);
  });
});

describe("Codex tool normalization keeps explicit strict flags", () => {
  const parameters = { type: "object", properties: { sessionID: { type: "string" } }, required: [] };

  it("preserves flat and nested strict flags and leaves optional args alone", () => {
    const body = {
      tools: [
        { type: "function", name: "flat_false", strict: false, parameters },
        { type: "function", name: "flat_true", strict: true, parameters },
        { type: "function", function: { name: "nested_false", strict: false, parameters } },
        { type: "function", function: { name: "nested_true", strict: true, parameters } },
        { type: "function", name: "unspecified", parameters },
      ],
    };

    normalizeCodexTools(body);

    expect(body.tools.map((t) => t.strict)).toEqual([false, true, false, true, undefined]);
    for (const tool of body.tools) {
      expect(tool.parameters.required).toEqual([]);
    }
    expect(body.tools[4]).not.toHaveProperty("strict");
  });
});