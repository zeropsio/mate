import { describe, expect, it } from "@effect/vitest";

import type { SpiEvent } from "@t3tools/contracts";

import { applyToolCall, readToolCall, sniffToolCallShape } from "./toolCall.ts";

let idCounter = 0;

/**
 * A minimal `SpiEvent` for one item lifecycle. `payload.data` is left to the
 * caller — these are the driver-specific shapes under test.
 */
const itemEvent = (options: {
  readonly type?: "item.started" | "item.updated" | "item.completed";
  readonly provider?: string;
  readonly itemType?: string;
  readonly status?: string;
  readonly title?: string;
  readonly data?: unknown;
}): SpiEvent =>
  ({
    eventId: `evt-${(idCounter += 1)}`,
    provider: options.provider ?? "claudeAgent",
    threadId: "thread-1",
    createdAt: "2026-08-29T00:00:00Z",
    type: options.type ?? "item.completed",
    payload: {
      itemType: options.itemType ?? "mcp_tool_call",
      ...(options.status !== undefined ? { status: options.status } : {}),
      ...(options.title !== undefined ? { title: options.title } : {}),
      data: options.data,
    },
  }) as unknown as SpiEvent;

/**
 * Claude's shape — `ClaudeAdapter.ts:2762-2766`, unconditionally the same
 * `{toolName, input, result?}` regardless of the item's classified
 * `itemType` (real recording:
 * `apps/server/src/spi/fixtures/claude/zerops-workflow-envelope.expected.json`,
 * `item-2`/`item-3`).
 */
const claudeToolCallData = (options: {
  readonly toolName?: string;
  readonly input?: unknown;
  readonly content?: unknown;
  readonly isError?: boolean;
  readonly started?: boolean;
}): unknown => ({
  toolName: options.toolName ?? "mcp__zerops__zerops_workflow",
  input: options.input ?? { action: "status" },
  ...(options.started === true
    ? {}
    : {
        result: {
          tool_use_id: "item-2",
          type: "tool_result",
          content: options.content ?? [{ type: "text", text: "## Status\nPhase: idle\n" }],
          ...(options.isError === true ? { is_error: true } : {}),
        },
      }),
});

/** Codex's `mcpToolCall` item variant — `CodexAdapter.ts:466-501`. */
const codexToolCallData = (options: {
  readonly tool?: string;
  readonly server?: string;
  readonly content?: unknown;
  readonly failed?: boolean;
  readonly started?: boolean;
}): unknown => ({
  item: {
    id: "item-0",
    type: "mcpToolCall",
    server: options.server ?? "zerops",
    tool: options.tool ?? "zerops_workflow",
    arguments: { action: "status" },
    status:
      options.started === true ? "inProgress" : options.failed === true ? "failed" : "completed",
    ...(options.started === true
      ? {}
      : {
          result: {
            content: options.content ?? [{ type: "text", text: "## Status\nPhase: idle\n" }],
          },
        }),
    ...(options.failed === true ? { error: { message: "tool failed" } } : {}),
  },
});

describe("readToolCall — Claude", () => {
  it("reads any tool, not only zerops_*", () => {
    const result = readToolCall(itemEvent({ data: claudeToolCallData({ toolName: "Bash" }) }));
    expect(result.kind).toBe("toolCall");
    expect(result.kind === "toolCall" && result.call).toEqual({
      name: "Bash",
      rawName: "Bash",
      arguments: { action: "status" },
      result: { text: "## Status\nPhase: idle\n", failed: false },
    });
  });

  it("strips the mcp__<server>__ prefix and reports the server", () => {
    const result = readToolCall(
      itemEvent({ data: claudeToolCallData({ toolName: "mcp__zerops__zerops_workflow" }) }),
    );
    expect(result.kind === "toolCall" && result.call.name).toBe("zerops_workflow");
    expect(result.kind === "toolCall" && result.call.rawName).toBe("mcp__zerops__zerops_workflow");
    expect(result.kind === "toolCall" && result.call.server).toBe("zerops");
  });

  it("accepts a bare string result content", () => {
    const result = readToolCall(itemEvent({ data: claudeToolCallData({ content: "plain text" }) }));
    expect(result.kind === "toolCall" && result.call.result?.text).toBe("plain text");
  });

  it("concatenates several text blocks in order, without a separator", () => {
    const result = readToolCall(
      itemEvent({
        data: claudeToolCallData({
          content: [
            { type: "text", text: "first" },
            { type: "image", source: {} },
            { type: "text", text: "second" },
          ],
        }),
      }),
    );
    expect(result.kind === "toolCall" && result.call.result?.text).toBe("firstsecond");
  });

  it("marks an errored result as failed", () => {
    const result = readToolCall(itemEvent({ data: claudeToolCallData({ isError: true }) }));
    expect(result.kind === "toolCall" && result.call.result?.failed).toBe(true);
  });

  it("reads Claude's own image content block alongside text (a real zerops_browser screenshot, verified.md 2026-09-04)", () => {
    // Real shape from a live probe: `tool_use_result` for a zerops_browser
    // call with screenshot:true was `[{type:"text",...}, {type:"image",
    // source:{type:"base64", media_type:"image/png", data:...}}]` — no
    // width/height on the block (the model only reported dimensions as prose).
    const result = readToolCall(
      itemEvent({
        data: claudeToolCallData({
          toolName: "mcp__zerops__zerops_browser",
          content: [
            { type: "text", text: "## Screenshot\n" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
          ],
        }),
      }),
    );
    expect(result.kind).toBe("toolCall");
    expect(result.kind === "toolCall" && result.call.result?.text).toBe("## Screenshot\n");
    expect(result.kind === "toolCall" && result.call.result?.images).toEqual([
      { mimeType: "image/png", data: "AAAA" },
    ]);
    expect(result.kind === "toolCall" && result.call.result?.imagesDropped).toBeUndefined();
  });

  it("also reads a flat {mimeType, data} image block (defensive fallback, e.g. width/height when a provider sends them)", () => {
    const result = readToolCall(
      itemEvent({
        data: claudeToolCallData({
          content: [
            { type: "text", text: "## Screenshot\n" },
            { type: "image", mimeType: "image/jpeg", data: "AAAA", width: 640, height: 360 },
          ],
        }),
      }),
    );
    expect(result.kind === "toolCall" && result.call.result?.images).toEqual([
      { mimeType: "image/jpeg", data: "AAAA", width: 640, height: 360 },
    ]);
  });

  it("drops an image content block over the 1 MiB base64 cap and flags it, keeping the text", () => {
    const oversized = "A".repeat(1024 * 1024 + 1);
    const result = readToolCall(
      itemEvent({
        data: claudeToolCallData({
          content: [
            { type: "text", text: "still here" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: oversized } },
          ],
        }),
      }),
    );
    expect(result.kind).toBe("toolCall");
    expect(result.kind === "toolCall" && result.call.result?.text).toBe("still here");
    expect(result.kind === "toolCall" && result.call.result?.images).toBeUndefined();
    expect(result.kind === "toolCall" && result.call.result?.imagesDropped).toBe(true);
  });

  it("keeps a real-world-sized screenshot (~301 KB base64, measured) under the cap", () => {
    const realistic = "A".repeat(301_160);
    const result = readToolCall(
      itemEvent({
        data: claudeToolCallData({
          content: [
            { type: "text", text: "..." },
            { type: "image", source: { type: "base64", media_type: "image/png", data: realistic } },
          ],
        }),
      }),
    );
    expect(result.kind === "toolCall" && result.call.result?.images?.length).toBe(1);
    expect(result.kind === "toolCall" && result.call.result?.imagesDropped).toBeUndefined();
  });

  it("reads a started call, which carries no result", () => {
    const result = readToolCall(
      itemEvent({ type: "item.started", data: claudeToolCallData({ started: true }) }),
    );
    expect(result.kind === "toolCall" && result.call.result).toBeUndefined();
  });

  it("reads zerops_delete even though Claude types it as a file change", () => {
    // classifyToolItemType (ClaudeAdapter.ts:736-771) tests `…delete…` before
    // `…mcp…`, so `mcp__zerops__zerops_delete` never arrives as
    // `mcp_tool_call`. The reader's gate is the DATA shape, not the itemType.
    const result = readToolCall(
      itemEvent({
        itemType: "file_change",
        data: claudeToolCallData({ toolName: "mcp__zerops__zerops_delete" }),
      }),
    );
    expect(result.kind === "toolCall" && result.call.name).toBe("zerops_delete");
  });
});

describe("readToolCall — Codex", () => {
  it("reads an mcpToolCall item", () => {
    const result = readToolCall(
      itemEvent({ provider: "codex", itemType: "mcp_tool_call", data: codexToolCallData({}) }),
    );
    expect(result.kind).toBe("toolCall");
    expect(result.kind === "toolCall" && result.call).toEqual({
      name: "zerops_workflow",
      rawName: "zerops_workflow",
      server: "zerops",
      arguments: { action: "status" },
      result: { text: "## Status\nPhase: idle\n", failed: false },
    });
  });

  it("marks an errored call as failed", () => {
    const result = readToolCall(
      itemEvent({
        provider: "codex",
        itemType: "mcp_tool_call",
        data: codexToolCallData({ failed: true }),
      }),
    );
    expect(result.kind === "toolCall" && result.call.result?.failed).toBe(true);
  });

  it("reads an image content block alongside text (e.g. a zerops_browser screenshot) — UNMEASURED, assumes the raw MCP protocol's flat ImageContent shape", () => {
    const result = readToolCall(
      itemEvent({
        provider: "codex",
        itemType: "mcp_tool_call",
        data: codexToolCallData({
          tool: "zerops_browser",
          content: [
            { type: "text", text: "## Screenshot\n" },
            { type: "image", mimeType: "image/jpeg", data: "AAAA", width: 640, height: 360 },
          ],
        }),
      }),
    );
    expect(result.kind).toBe("toolCall");
    expect(result.kind === "toolCall" && result.call.result?.images).toEqual([
      { mimeType: "image/jpeg", data: "AAAA", width: 640, height: 360 },
    ]);
  });

  it("reads a started call, which carries no result", () => {
    const result = readToolCall(
      itemEvent({
        type: "item.started",
        provider: "codex",
        itemType: "mcp_tool_call",
        data: codexToolCallData({ started: true }),
      }),
    );
    expect(result.kind === "toolCall" && result.call.result).toBeUndefined();
  });

  it("does not embed the server in the name (Codex reports it separately)", () => {
    const result = readToolCall(
      itemEvent({
        provider: "codex",
        itemType: "mcp_tool_call",
        data: codexToolCallData({ tool: "zerops_deploy" }),
      }),
    );
    expect(result.kind === "toolCall" && result.call.name).toBe("zerops_deploy");
    expect(result.kind === "toolCall" && result.call.rawName).toBe("zerops_deploy");
  });
});

describe("readToolCall — not a tool call (silent)", () => {
  it("an event type outside the item lifecycle", () => {
    const event = {
      ...itemEvent({ data: claudeToolCallData({}) }),
      type: "turn.started",
    } as SpiEvent;
    expect(readToolCall(event).kind).toBe("notATool");
  });

  it("a provider with no reader", () => {
    const result = readToolCall(itemEvent({ provider: "unknown", data: claudeToolCallData({}) }));
    expect(result.kind).toBe("notATool");
  });

  it("a Claude item whose data carries no toolName (not a tool-lifecycle itemType)", () => {
    const result = readToolCall(itemEvent({ itemType: "assistant_message", data: null }));
    expect(result.kind).toBe("notATool");
  });

  it.each([
    ["commandExecution", "command_execution", { command: "/usr/bin/zsh -lc 'npm test'" }],
    ["fileChange", "file_change", { changes: [] }],
  ] as const)(
    "a Codex %s item: Codex's own tool, never an MCP call, and nothing downstream reads it",
    (type, itemType, fields) => {
      const result = readToolCall(
        itemEvent({
          provider: "codex",
          itemType,
          data: { item: { type, id: "call_1", ...fields } },
        }),
      );
      expect(result.kind).toBe("notATool");
    },
  );

  it("a Codex item that is not an mcpToolCall, and not a tool-lifecycle itemType either", () => {
    const result = readToolCall(
      itemEvent({
        provider: "codex",
        itemType: "reasoning",
        data: { item: { type: "somethingElse" } },
      }),
    );
    expect(result.kind).toBe("notATool");
  });
});

describe("readToolCall — unrecognized (loud)", () => {
  it("a recognized tool-lifecycle itemType whose Claude data has no toolName", () => {
    const result = readToolCall(itemEvent({ itemType: "command_execution", data: { input: {} } }));
    expect(result.kind).toBe("unrecognized");
    expect(result.kind === "unrecognized" && result.itemType).toBe("command_execution");
    expect(result.kind === "unrecognized" && result.reason).toContain("toolName");
  });

  it("a Claude result that is not an object", () => {
    const result = readToolCall(
      itemEvent({
        data: { toolName: "mcp__zerops__zerops_workflow", input: {}, result: "not an object" },
      }),
    );
    expect(result.kind).toBe("unrecognized");
  });

  it("a Claude result whose content has no readable text", () => {
    const result = readToolCall(
      itemEvent({
        data: {
          toolName: "mcp__zerops__zerops_workflow",
          input: {},
          result: { content: 42 },
        },
      }),
    );
    expect(result.kind).toBe("unrecognized");
  });

  it("a Claude result whose content is all image blocks reads as empty text, not unrecognized", () => {
    const result = readToolCall(
      itemEvent({
        data: {
          toolName: "mcp__zerops__zerops_workflow",
          input: {},
          result: { content: [{ type: "image", source: {} }] },
        },
      }),
    );
    expect(result.kind).toBe("toolCall");
    expect(result.kind === "toolCall" && result.call.result?.text).toBe("");
  });

  it("a recognized Codex tool-lifecycle itemType that is not mcpToolCall (e.g. a collabAgentToolCall)", () => {
    // Real shape from `apps/server/src/spi/fixtures/codex/multi-agent-wire.expected.json`
    // ("wait" collab-agent item) — a genuine, classified tool item this
    // module does not (yet) read.
    const result = readToolCall(
      itemEvent({
        provider: "codex",
        itemType: "collab_agent_tool_call",
        data: {
          item: { type: "collabAgentToolCall", id: "item-0", tool: "wait", status: "completed" },
          threadId: "thread-1",
          turnId: "turn-0",
        },
      }),
    );
    expect(result.kind).toBe("unrecognized");
    expect(result.kind === "unrecognized" && result.itemType).toBe("collab_agent_tool_call");
    expect(result.kind === "unrecognized" && result.reason).toContain("collabAgentToolCall");
  });

  it("a Codex mcpToolCall item with no tool name", () => {
    const result = readToolCall(
      itemEvent({
        provider: "codex",
        itemType: "mcp_tool_call",
        data: { item: { type: "mcpToolCall", server: "zerops" } },
      }),
    );
    expect(result.kind).toBe("unrecognized");
  });

  it("payload.data that is not an object, on a recognized tool-lifecycle itemType", () => {
    const result = readToolCall(itemEvent({ itemType: "file_change", data: "not an object" }));
    expect(result.kind).toBe("unrecognized");
  });
});

describe("applyToolCall", () => {
  it("attaches toolCall when the shape is recognized", () => {
    const event = itemEvent({ data: claudeToolCallData({}) });
    const enriched = applyToolCall(event);
    expect(enriched.toolCall?.name).toBe("zerops_workflow");
  });

  it("leaves the event unchanged when it is not a tool call", () => {
    const event = itemEvent({ itemType: "assistant_message", data: null });
    expect(applyToolCall(event)).toBe(event);
  });

  it("leaves the event unchanged (no toolCall) when the shape is unrecognized", () => {
    const event = itemEvent({ itemType: "command_execution", data: { input: {} } });
    const enriched = applyToolCall(event);
    expect(enriched.toolCall).toBeUndefined();
  });

  it("recomputes from payload.data rather than trusting an existing toolCall", () => {
    const event = {
      ...itemEvent({ data: claudeToolCallData({ toolName: "mcp__zerops__zerops_workflow" }) }),
      toolCall: { name: "stale", rawName: "stale" },
    } as SpiEvent;
    const enriched = applyToolCall(event);
    expect(enriched.toolCall?.name).toBe("zerops_workflow");
  });
});

/**
 * `sniffToolCallShape` is the ONE compat exception to "know the provider
 * first": `apps/server/src/orchestration/ActivityPayloadProjection.ts`
 * projects a driver-agnostic `OrchestrationThreadActivity` that carries no
 * `provider` field, only `payload.data` — so it cannot call `readToolCall`
 * (which needs `event.provider`) at all.
 */
describe("sniffToolCallShape", () => {
  it("recognizes a Claude shape without being told the provider", () => {
    const result = sniffToolCallShape(
      claudeToolCallData({ toolName: "mcp__zerops__zerops_deploy" }),
    );
    expect(result.kind).toBe("toolCall");
    expect(result.kind === "toolCall" && result.call.name).toBe("zerops_deploy");
  });

  it("recognizes a Codex mcpToolCall shape without being told the provider", () => {
    const result = sniffToolCallShape(codexToolCallData({ tool: "zerops_deploy" }));
    expect(result.kind).toBe("toolCall");
    expect(result.kind === "toolCall" && result.call.name).toBe("zerops_deploy");
  });

  it("returns notATool for a shape neither reader recognizes", () => {
    const result = sniffToolCallShape({ command: "ls" });
    expect(result.kind).toBe("notATool");
  });
});

/**
 * OpenCode's shape (`OpenCodeAdapter.ts`, `message.part.updated` of a tool
 * part): `data = {tool, state}`. An MCP tool is named `<server>_<tool>`; its
 * result is `state.output`, its failure `state.error`.
 */
const openCodeData = (tool: string, state: Record<string, unknown>) => ({ tool, state });

describe("readToolCall — OpenCode", () => {
  it.each([
    { tool: "zerops_zerops_deploy", name: "zerops_deploy", server: "zerops" },
    { tool: "github_create_issue", name: "create_issue", server: "github" },
    { tool: "read", name: "read", server: undefined },
    { tool: "apply_patch", name: "apply_patch", server: undefined },
  ])("names $tool as $name", ({ tool, name, server }) => {
    const result = readToolCall(
      itemEvent({
        provider: "opencode",
        type: "item.updated",
        itemType: "dynamic_tool_call",
        data: openCodeData(tool, { status: "running", input: { serviceHostname: "api" } }),
      }),
    );
    expect(result).toEqual({
      kind: "toolCall",
      call: {
        name,
        rawName: tool,
        ...(server === undefined ? {} : { server }),
        arguments: { serviceHostname: "api" },
      },
    });
  });

  it.each([
    {
      name: "a completed call returns its output",
      state: { status: "completed", input: {}, output: '{"status":"FINISHED"}' },
      result: { text: '{"status":"FINISHED"}', failed: false },
    },
    {
      name: "a failed call returns its error",
      state: { status: "error", input: {}, error: "service not found" },
      result: { text: "service not found", failed: true },
    },
    {
      name: "a picture comes back as an attachment",
      state: {
        status: "completed",
        input: {},
        output: "screenshot taken",
        attachments: [{ type: "file", mime: "image/png", url: "data:image/png;base64,iVBORw0K" }],
      },
      result: {
        text: "screenshot taken",
        failed: false,
        images: [{ mimeType: "image/png", data: "iVBORw0K" }],
      },
    },
  ])("$name", ({ state, result }) => {
    const read = readToolCall(
      itemEvent({
        provider: "opencode",
        itemType: "dynamic_tool_call",
        data: openCodeData("zerops_zerops_browser", state),
      }),
    );
    expect(read.kind === "toolCall" && read.call.result).toEqual(result);
  });

  it("is unrecognized when a tool item carries no tool name", () => {
    const read = readToolCall(
      itemEvent({ provider: "opencode", itemType: "dynamic_tool_call", data: { state: {} } }),
    );
    expect(read.kind).toBe("unrecognized");
  });
});

/**
 * The ACP agents' shape (`AcpRuntimeModel.ts` `makeToolCallState`): `data =
 * {toolCallId, kind?, command?, rawInput?, rawOutput?, content?, locations?}`,
 * the call's title on the payload. ACP names no tool: an MCP call is known by
 * the name its title carries, a native one by its kind.
 */
const acpEvent = (options: {
  readonly provider?: string;
  readonly title?: string;
  readonly status?: string;
  readonly data: Record<string, unknown>;
}) =>
  itemEvent({
    provider: options.provider ?? "cursor",
    type:
      options.status === "completed" || options.status === "failed"
        ? "item.completed"
        : "item.updated",
    itemType: "dynamic_tool_call",
    status: options.status ?? "inProgress",
    ...(options.title === undefined ? {} : { title: options.title }),
    data: { toolCallId: "call-1", ...options.data },
  });

describe("readToolCall — ACP (cursor, grok, antigravity)", () => {
  it.each([
    { title: "Running zerops_deploy", name: "zerops_deploy", server: undefined },
    { title: "mcp__zerops__zerops_deploy", name: "zerops_deploy", server: "zerops" },
    { title: "zerops-zerops_deploy", name: "zerops_deploy", server: "zerops" },
    { title: "zerops_zerops_deploy", name: "zerops_deploy", server: "zerops" },
    { title: "zerops: zerops_deploy", name: "zerops_deploy", server: "zerops" },
    { title: "zerops_deploy", name: "zerops_deploy", server: undefined },
    { title: "enter_plan_mode", name: "enter_plan_mode", server: undefined },
  ])("names the call titled $title as $name", ({ title, name, server }) => {
    const result = readToolCall(
      acpEvent({ title, data: { kind: "other", rawInput: { targetService: "api" } } }),
    );
    expect(result).toEqual({
      kind: "toolCall",
      call: {
        name,
        rawName: title,
        ...(server === undefined ? {} : { server }),
        arguments: { targetService: "api" },
      },
    });
  });

  it.each([
    { kind: "read", title: "Read file" },
    { kind: "edit", title: "Changed files" },
    { kind: "search", title: "Searched files" },
    { kind: "execute", title: "Ran command" },
  ])("names a native $kind call by its kind", ({ kind, title }) => {
    const result = readToolCall(acpEvent({ title, data: { kind } }));
    expect(result.kind === "toolCall" && result.call.name).toBe(kind);
  });

  it("never names a native call by what its title mentions", () => {
    const result = readToolCall(
      acpEvent({ title: "`grep -r zerops_deploy src`", data: { kind: "execute" } }),
    );
    expect(result.kind === "toolCall" && result.call.name).toBe("execute");
  });

  it.each(["grok", "antigravity"])("reads %s the same way", (provider) => {
    const result = readToolCall(acpEvent({ provider, title: "Running zerops_standup", data: {} }));
    expect(result.kind === "toolCall" && result.call.name).toBe("zerops_standup");
  });

  it.each([
    {
      name: "the MCP result in rawOutput",
      status: "completed",
      data: { rawOutput: { content: [{ type: "text", text: '{"ok":true}' }] } },
      result: { text: '{"ok":true}', failed: false },
    },
    {
      name: "the ACP content's text",
      status: "completed",
      data: { content: [{ type: "content", content: { type: "text", text: '{"ok":true}' } }] },
      result: { text: '{"ok":true}', failed: false },
    },
    {
      name: "a bare string rawOutput",
      status: "completed",
      data: { rawOutput: '{"ok":true}' },
      result: { text: '{"ok":true}', failed: false },
    },
    {
      name: "a failure",
      status: "failed",
      data: { rawOutput: { content: [{ type: "text", text: "no such service" }], isError: true } },
      result: { text: "no such service", failed: true },
    },
    {
      name: "a picture in the ACP content",
      status: "completed",
      data: {
        content: [
          { type: "content", content: { type: "text", text: "shot" } },
          { type: "content", content: { type: "image", data: "iVBORw0K", mimeType: "image/png" } },
        ],
      },
      result: {
        text: "shot",
        failed: false,
        images: [{ mimeType: "image/png", data: "iVBORw0K" }],
      },
    },
  ])("returns $name", ({ status, data, result }) => {
    const read = readToolCall(acpEvent({ title: "Running zerops_browser", status, data }));
    expect(read.kind === "toolCall" && read.call.result).toEqual(result);
  });

  it("carries no result while the call runs", () => {
    const read = readToolCall(
      acpEvent({ title: "Running zerops_deploy", data: { rawOutput: "partial" } }),
    );
    expect(read.kind === "toolCall" && read.call.result).toBeUndefined();
  });

  it("is unrecognized when neither a kind nor a name says what the call is", () => {
    const read = readToolCall(acpEvent({ title: "Doing something", data: {} }));
    expect(read.kind).toBe("unrecognized");
  });
});

describe("sniffToolCallShape — every driver", () => {
  it("recognizes an OpenCode shape", () => {
    const result = sniffToolCallShape(
      openCodeData("zerops_zerops_deploy", { status: "running", input: {} }),
    );
    expect(result.kind === "toolCall" && result.call.name).toBe("zerops_deploy");
  });

  it("recognizes an ACP shape by the title it is given", () => {
    const result = sniffToolCallShape(
      { toolCallId: "call-1", kind: "other" },
      "Running zerops_deploy",
    );
    expect(result.kind === "toolCall" && result.call.name).toBe("zerops_deploy");
  });

  it("recognizes an ACP native call by its kind", () => {
    const result = sniffToolCallShape({ toolCallId: "call-1", kind: "read" }, "Read file");
    expect(result.kind === "toolCall" && result.call.name).toBe("read");
  });
});
