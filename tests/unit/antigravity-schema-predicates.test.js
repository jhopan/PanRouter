import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

// Gemini's Schema proto gates fields on the node's own type:
//   items                → predicate $type == Type.ARRAY
//   properties, required → predicate $type == Type.OBJECT
// and `required` may only name keys the object declares. Antigravity answers the
// whole request with 400 INVALID_ARGUMENT when one node breaks its predicate, so
// cleanJSONSchemaForAntigravity has to enforce them at every depth.

// Recursive predicate checker: returns human-readable violations (empty = clean).
// `properties` is a name → schema map, so it is walked value-wise, not as a node.
function violations(node, path = "parameters", found = []) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return found;

  const type = node.type;
  if (node.items !== undefined && type !== "array") found.push(`${path}.items on type ${type}`);
  if (node.properties !== undefined && type !== "object") found.push(`${path}.properties on type ${type}`);
  if (node.required !== undefined) {
    if (type !== "object") found.push(`${path}.required on type ${type}`);
    else if (!Array.isArray(node.required)) found.push(`${path}.required is not an array`);
    else {
      for (const key of node.required) {
        const declared = node.properties && Object.prototype.hasOwnProperty.call(node.properties, key);
        if (!declared) found.push(`${path}.required names undeclared "${key}"`);
      }
    }
  }

  if (type === "object" && node.properties && typeof node.properties === "object" && !Array.isArray(node.properties)) {
    for (const [key, sub] of Object.entries(node.properties)) violations(sub, `${path}.properties.${key}`, found);
  }
  if (node.items !== undefined) violations(node.items, `${path}.items`, found);
  for (const keyword of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(node[keyword])) {
      node[keyword].forEach((sub, i) => violations(sub, `${path}.${keyword}[${i}]`, found));
    }
  }
  return found;
}

const clean = (schema) => cleanJSONSchemaForAntigravity(structuredClone(schema));

describe("cleanJSONSchemaForAntigravity enforces Gemini type predicates", () => {
  const cases = [
    {
      name: "keeps items on an array",
      schema: { type: "array", items: { type: "integer" } },
      expect: (out) => expect(out).toEqual({ type: "array", items: { type: "integer" } }),
    },
    {
      name: "drops items on a string",
      schema: { type: "string", items: { type: "string" } },
      expect: (out) => expect(out).toEqual({ type: "string" }),
    },
    {
      name: "drops items on an object",
      schema: { type: "object", properties: { a: { type: "string" } }, items: { type: "number" } },
      expect: (out) => expect(out).toEqual({ type: "object", properties: { a: { type: "string" } } }),
    },
    {
      name: "drops items from a typeless node (items needs an ARRAY type)",
      schema: { description: "orphan", items: { type: "string" } },
      expect: (out) => expect(out).toEqual({ description: "orphan" }),
    },
    {
      name: "fills items for an array that has none",
      schema: { type: "array" },
      expect: (out) => expect(out).toEqual({ type: "array", items: { type: "string" } }),
    },
    {
      name: "drops properties and required on an array",
      schema: {
        type: "array",
        items: { type: "string" },
        properties: { foo: { type: "string" } },
        required: ["foo"],
      },
      expect: (out) => expect(out).toEqual({ type: "array", items: { type: "string" } }),
    },
    {
      name: "drops properties and required on an integer",
      schema: { type: "integer", properties: { foo: { type: "string" } }, required: ["foo"] },
      expect: (out) => expect(out).toEqual({ type: "integer" }),
    },
    {
      name: "prunes required keys the object does not declare",
      schema: {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "integer" } },
        required: ["a", "ghost", "other"],
      },
      expect: (out) => {
        expect(out.required).toEqual(["a"]);
        expect(out.properties).toEqual({ a: { type: "string" }, b: { type: "integer" } });
      },
    },
    {
      name: "removes required entirely when no key is declared",
      schema: { type: "object", properties: { a: { type: "string" } }, required: ["ghost"] },
      expect: (out) => {
        expect(out).not.toHaveProperty("required");
        expect(out.properties.a).toEqual({ type: "string" });
      },
    },
    {
      name: "gives an object without properties the reason placeholder it requires",
      schema: { type: "object", required: ["ghost"] },
      expect: (out) => {
        expect(out.type).toBe("object");
        expect(out.required).toEqual(["reason"]);
        expect(out.properties.reason.type).toBe("string");
      },
    },
    {
      name: "keeps a parameter literally named items",
      schema: {
        type: "object",
        properties: { items: { type: "array", items: { type: "string" } } },
        required: ["items"],
      },
      expect: (out) => {
        expect(out.properties.items).toEqual({ type: "array", items: { type: "string" } });
        expect(out.required).toEqual(["items"]);
      },
    },
    {
      name: "keeps a parameter literally named required",
      schema: {
        type: "object",
        properties: { required: { type: "string" }, nested: { type: "object", properties: { required: { type: "string" } } } },
      },
      expect: (out) => {
        expect(out.properties.required).toEqual({ type: "string" });
        expect(out.properties.nested.properties.required).toEqual({ type: "string" });
      },
    },
    {
      name: "drops items carried by a property map itself",
      schema: {
        type: "object",
        properties: { a: { type: "string" } },
        items: { type: "object", properties: { b: { type: "string" } } },
      },
      expect: (out) => {
        expect(out).not.toHaveProperty("items");
        expect(out.properties).toEqual({ a: { type: "string" } });
      },
    },
    {
      name: "recurses object in array in object",
      schema: {
        type: "object",
        properties: {
          outer: {
            type: "object",
            properties: {
              inner: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", items: { type: "string" } },
                    deep: { type: "array", items: { type: "array", items: { type: "object", properties: { v: { type: "number" } } } } },
                  },
                  required: ["name", "absent"],
                },
              },
            },
          },
        },
      },
      expect: (out) => {
        expect(violations(out)).toEqual([]);
        const item = out.properties.outer.properties.inner.items;
        expect(item.properties.name).toEqual({ type: "string" });
        expect(item.required).toEqual(["name"]);
        expect(item.properties.deep.items.items).toEqual({ type: "object", properties: { v: { type: "number" } } });
      },
    },
    {
      name: "resolves a multi-type union to the type its structure supports",
      schema: {
        type: "object",
        properties: {
          unionObject: { type: ["null", "boolean", "object"], properties: { a: { type: "string" } }, required: ["a"] },
          unionArray: { type: ["null", "boolean", "array"], items: { type: "string" } },
          scalar: { type: ["null", "boolean"] },
        },
      },
      expect: (out) => {
        expect(out.properties.unionObject).toEqual({ type: "object", properties: { a: { type: "string" } }, required: ["a"] });
        expect(out.properties.unionArray).toEqual({ type: "array", items: { type: "string" } });
        expect(out.properties.scalar).toEqual({ type: "boolean" });
      },
    },
    {
      name: "does not invent an object type from a bare union",
      schema: { type: ["string", "object"] },
      expect: (out) => expect(out).toEqual({ type: "string" }),
    },
  ];

  it.each(cases)("$name", ({ schema, expect: assert }) => {
    const out = clean(schema);
    assert(out);
    expect(violations(out)).toEqual([]);
  });
});

describe("cleanJSONSchemaForAntigravity with a Claude-CLI shaped tool schema", () => {
  // Shaped like the schemas Claude Code / CLI tools actually send: union types,
  // tuple arrays, ~optional markers, minItems, and objects nested under arrays.
  const claudeToolSchema = () => ({
    type: "object",
    "~optional": true,
    properties: {
      command: { type: "string", minLength: 1, description: "Shell command to run" },
      timeout: { type: ["integer", "null"], description: "Timeout in ms" },
      edits: {
        type: "array",
        prefixItems: [{ type: "object", properties: { old_string: { type: "string" } }, required: ["old_string"] }],
        minItems: 1,
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            mode: { const: "replace", type: ["string", "null"] },
          },
          required: ["path", "ghost"],
        },
      },
      nested: {
        type: "object",
        properties: {
          groups: {
            type: "array",
            properties: { bogus: { type: "string" } },
            required: ["bogus"],
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                tags: { type: "array", items: { type: ["string", "null"] } },
                matrix: { type: "array", items: { type: "array", items: { type: "object", properties: { v: { type: "number" } } } } },
              },
              required: ["id", "missing"],
            },
          },
          scalar: { type: "string", items: { type: "string" } },
        },
      },
      literal: { type: ["null", "boolean", "object", "array", "number", "string"], items: {}, description: "union with empty items" },
    },
    required: ["command", "absent"],
  });

  it("satisfies every predicate at every depth", () => {
    const out = clean(claudeToolSchema());

    expect(violations(out)).toEqual([]);
    expect(JSON.stringify(out)).not.toContain("~optional");
  });

  it("keeps the real structure of the tool", () => {
    const out = clean(claudeToolSchema());

    expect(out.required).toEqual(["command"]);
    expect(out.properties.command).toEqual({ type: "string", description: "Shell command to run" });
    expect(out.properties.timeout.type).toBe("integer");

    const edits = out.properties.edits;
    expect(edits.type).toBe("array");
    expect(edits).not.toHaveProperty("prefixItems");
    expect(edits).not.toHaveProperty("minItems");
    expect(edits.items.type).toBe("object");
    expect(edits.items.required).toEqual(["path"]);
    expect(edits.items.properties.mode).toEqual({ type: "string", enum: ["replace"] });

    const groups = out.properties.nested.properties.groups;
    expect(groups.type).toBe("array");
    expect(groups).not.toHaveProperty("properties");
    expect(groups).not.toHaveProperty("required");
    expect(groups.items.required).toEqual(["id"]);
    expect(groups.items.properties.tags).toEqual({ type: "array", items: { type: "string" } });
    expect(groups.items.properties.matrix.items.items).toEqual({ type: "object", properties: { v: { type: "number" } } });

    expect(out.properties.nested.properties.scalar).toEqual({ type: "string" });
    expect(out.properties.literal.type).toBe("string");
    expect(out.properties.literal).not.toHaveProperty("items");
  });
});

describe("Antigravity tool-call request body is unchanged by the predicate pass", () => {
  it("keeps an already-valid tool body byte-identical", () => {
    const out = openaiToAntigravityRequest("gemini-3.5-flash-low", {
      messages: [
        { role: "user", content: "read the file" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a.txt\"}" } }],
        },
        { role: "tool", tool_call_id: "call_1", content: "hi" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
              lines: { type: "array", items: { type: "integer" } },
            },
            required: ["path"],
          },
        },
      }],
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    expect(out.request.tools).toEqual([{
      functionDeclarations: [{
        name: "read_file",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            lines: { type: "array", items: { type: "integer" } },
          },
          required: ["path"],
        },
      }],
    }]);

    const parts = out.request.contents.flatMap((content) => content.parts);
    const call = parts.find((part) => part.functionCall);
    const response = parts.find((part) => part.functionResponse);
    expect(call.functionCall.name).toBe("read_file");
    expect(call.functionCall.args).toEqual({ path: "a.txt" });
    expect(response.functionResponse.name).toBe("read_file");
    expect(violations(out.request.tools[0].functionDeclarations[0].parameters)).toEqual([]);
  });
});