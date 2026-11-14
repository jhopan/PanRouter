import { describe, expect, it } from "vitest";
import { dedupeTools } from "../../open-sse/utils/toolDeduper.js";
import { CLAUDE_BLOCK } from "../../open-sse/translator/schema/blocks.js";

const TOOLS = (names) => names.map((name) => ({ name, description: `${name} tool`, input_schema: {} }));

// Claude Code's deferred tool loading leaves these in history; a reference to a
// tool the request no longer declares makes strict Claude-compatible upstreams
// reject the WHOLE request (z.ai 400 code 1210), so it must be cleaned with the
// strip that caused it.
describe("dedupeTools cleans tool_reference blocks naming stripped tools", () => {
  it("drops the dangling reference when the Exa MCP replaces WebSearch", () => {
    const tools = TOOLS(["mcp__exa__web_search_exa", "WebSearch", "Bash"]);
    const messages = [
      {
        role: "user",
        content: [
          {
            type: CLAUDE_BLOCK.TOOL_RESULT,
            tool_use_id: "t1",
            content: [
              { type: CLAUDE_BLOCK.TEXT, text: "search finished" },
              { type: CLAUDE_BLOCK.TOOL_REFERENCE, tool_name: "WebSearch" },
            ],
          },
        ],
      },
    ];

    const { tools: out, stripped } = dedupeTools(tools, { messages });

    expect(stripped).toContain("WebSearch");
    expect(out.map((t) => t.name)).toEqual(["mcp__exa__web_search_exa", "Bash"]);
    const content = messages[0].content[0].content;
    expect(content.some((p) => p.type === CLAUDE_BLOCK.TOOL_REFERENCE)).toBe(false);
    expect(content).toHaveLength(1);
    expect(content[0].text).toBe("search finished");
  });

  it("leaves a text note instead of an empty content array", () => {
    const tools = TOOLS(["mcp__exa__web_fetch_exa", "WebFetch"]);
    const messages = [
      {
        role: "user",
        content: [
          {
            type: CLAUDE_BLOCK.TOOL_RESULT,
            tool_use_id: "t2",
            content: [{ type: CLAUDE_BLOCK.TOOL_REFERENCE, tool_name: "WebFetch" }],
          },
        ],
      },
    ];

    const { stripped } = dedupeTools(tools, { messages });

    expect(stripped).toContain("WebFetch");
    const content = messages[0].content[0].content;
    expect(content).toHaveLength(1);              // never an empty array
    expect(content[0].type).toBe(CLAUDE_BLOCK.TEXT);
    expect(content[0].text).toContain("WebFetch");
  });

  it("keeps references to tools that are still declared", () => {
    const tools = TOOLS(["mcp__exa__web_search_exa", "WebSearch", "Bash"]);
    const messages = [
      {
        role: "user",
        content: [
          {
            type: CLAUDE_BLOCK.TOOL_RESULT,
            tool_use_id: "t3",
            content: [{ type: CLAUDE_BLOCK.TOOL_REFERENCE, tool_name: "Bash" }],
          },
        ],
      },
    ];

    dedupeTools(tools, { messages });

    expect(messages[0].content[0].content).toHaveLength(1);
    expect(messages[0].content[0].content[0].tool_name).toBe("Bash");
  });

  it("does not touch messages when nothing is stripped", () => {
    const tools = TOOLS(["Bash", "Read"]);
    const messages = [
      {
        role: "user",
        content: [
          {
            type: CLAUDE_BLOCK.TOOL_RESULT,
            tool_use_id: "t4",
            content: [{ type: CLAUDE_BLOCK.TOOL_REFERENCE, tool_name: "WebSearch" }],
          },
        ],
      },
    ];
    const before = JSON.stringify(messages);

    const { stripped } = dedupeTools(tools, { messages });

    expect(stripped).toEqual([]);
    expect(JSON.stringify(messages)).toBe(before);
  });

  it("still works when no messages are supplied", () => {
    const tools = TOOLS(["mcp__exa__web_search_exa", "WebSearch"]);
    const { out, stripped } = { out: dedupeTools(tools).tools, stripped: dedupeTools(tools).stripped };
    expect(stripped).toContain("WebSearch");
    expect(out.map((t) => t.name)).toEqual(["mcp__exa__web_search_exa"]);
  });
});
