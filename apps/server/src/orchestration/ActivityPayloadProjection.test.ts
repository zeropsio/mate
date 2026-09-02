import { describe, expect, it } from "vite-plus/test";
import type {
  OrchestrationEvent,
  OrchestrationThreadActivity,
  OrchestrationThreadDetailSnapshot,
} from "@t3tools/contracts";
import {
  projectActivityEvent,
  projectActivityPayload,
  projectThreadDetailSnapshot,
} from "./ActivityPayloadProjection.ts";

function activity(payload: Record<string, unknown>): OrchestrationThreadActivity {
  return {
    id: "activity-1",
    tone: "tool",
    kind: "tool.completed",
    summary: "Tool",
    payload,
    turnId: null,
    createdAt: "2026-08-01T10:00:00.000Z",
  } as unknown as OrchestrationThreadActivity;
}

/**
 * Wire-survival regression: the slimming pass rewrites payload.data but must
 * never strip the top-level per-agent fields the subagent fold depends on.
 * If slimming ever moves to an allowlist over the whole payload, these
 * assertions are the tripwire.
 */
describe("projectActivityPayload", () => {
  it("preserves tool attribution (agentId/parentToolUseId) through data slimming", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "command_execution",
        agentId: "task-123",
        parentToolUseId: "toolu_abc",
        data: {
          toolName: "Bash",
          input: { command: "ls" },
          command: "ls",
          rawOutput: { content: "x".repeat(10) },
          somethingClientNeverReads: { big: "blob" },
        },
      }),
    );
    const payload = projected.payload as Record<string, unknown>;
    expect(payload.agentId).toBe("task-123");
    expect(payload.parentToolUseId).toBe("toolu_abc");
    // Slimming itself still applies to data.
    const data = payload.data as Record<string, unknown>;
    expect(data.somethingClientNeverReads).toBeUndefined();
  });

  it("keeps a bounded Codex command output summary", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "command_execution",
        data: {
          item: {
            command: "/bin/zsh -lc 'printf hello'",
            aggregatedOutput: `hello from codex\n${"x".repeat(5000)}`,
          },
        },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.item).toEqual({
      command: "/bin/zsh -lc 'printf hello'",
      aggregatedOutput: "hello from codex",
    });
    expect(JSON.stringify(projected.payload).length).toBeLessThan(500);
  });

  it("keeps preview normalization and fence-only fallback while scanning lines", () => {
    const preview = projectActivityPayload(
      activity({
        itemType: "command_execution",
        data: { rawOutput: `\`\`\`\n  actual\tresult  \n${"x".repeat(5000)}` },
      }),
    );
    const fences = projectActivityPayload(
      activity({
        itemType: "command_execution",
        data: { rawOutput: "```\r\n \t \n```\n" },
      }),
    );

    expect((preview.payload as { data: { rawOutput: unknown } }).data.rawOutput).toEqual({
      content: "actual result",
    });
    expect((fences.payload as { data: { rawOutput: unknown } }).data.rawOutput).toEqual({
      content: "2 lines",
    });
  });

  it("keeps bounded Claude and ACP command output summaries", () => {
    const claude = projectActivityPayload(
      activity({
        itemType: "command_execution",
        data: {
          command: "printf hello",
          rawOutput: { stdout: `hello from claude\n${"y".repeat(5000)}` },
        },
      }),
    );
    const acp = projectActivityPayload(
      activity({
        itemType: "command_execution",
        data: {
          command: "printf hello",
          content: [
            {
              type: "content",
              content: { type: "text", text: `hello from acp\n${"z".repeat(5000)}` },
            },
          ],
        },
      }),
    );

    const claudeData = (claude.payload as Record<string, unknown>).data as Record<string, unknown>;
    const acpData = (acp.payload as Record<string, unknown>).data as Record<string, unknown>;
    expect(claudeData.rawOutput).toEqual({ content: "hello from claude" });
    expect(acpData.rawOutput).toEqual({ content: "hello from acp" });
    expect(JSON.stringify(claude.payload).length).toBeLessThan(500);
    expect(JSON.stringify(acp.payload).length).toBeLessThan(500);
  });

  it("normalizes Claude and OpenCode command inputs before slimming provider data", () => {
    const claude = projectActivityPayload(
      activity({
        itemType: "command_execution",
        toolCallId: "claude-call-1",
        data: {
          toolName: "Bash",
          input: { command: "vp test run" },
          result: { content: "x".repeat(5_000) },
        },
      }),
    );
    const openCode = projectActivityPayload(
      activity({
        itemType: "command_execution",
        toolCallId: "opencode-call-1",
        data: {
          tool: "bash",
          state: {
            status: "running",
            input: { command: "vp lint" },
            output: "x".repeat(5_000),
          },
        },
      }),
    );

    expect(claude.payload).toMatchObject({
      toolCallId: "claude-call-1",
      data: { command: "vp test run" },
    });
    expect(openCode.payload).toMatchObject({
      toolCallId: "opencode-call-1",
      data: { command: "vp lint" },
    });
    expect(JSON.stringify(claude.payload).length).toBeLessThan(200);
    expect(JSON.stringify(openCode.payload).length).toBeLessThan(200);
  });

  it("slims Codex-shaped mcp_tool_call items to rendered fields plus a result summary", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "mcp_tool_call",
        data: {
          item: {
            type: "mcpToolCall",
            id: "item-1",
            tool: "fetch_pr",
            server: "github",
            status: "completed",
            arguments: { pr: 42 },
            durationMs: 1200,
            result: {
              content: [{ type: "text", text: `PR body line one\n${"x".repeat(5000)}` }],
              structuredContent: { huge: "y".repeat(5000) },
            },
            _meta: { internal: true },
          },
        },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;
    const item = data.item as Record<string, unknown>;
    expect(item.tool).toBe("fetch_pr");
    expect(item.server).toBe("github");
    expect(item.arguments).toEqual({ pr: 42 });
    expect(item._meta).toBeUndefined();
    expect(item.result).toEqual({ content: "PR body line one" });
    expect(JSON.stringify(projected.payload).length).toBeLessThan(500);
  });

  it("slims Claude-shaped mcp_tool_call data (toolName/input/result block)", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "mcp_tool_call",
        data: {
          toolName: "mcp__github__fetch_pr",
          input: { pr: 42 },
          result: {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: [{ type: "text", text: `first line of output\n${"z".repeat(5000)}` }],
          },
        },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.toolName).toBe("mcp__github__fetch_pr");
    expect(data.input).toEqual({ pr: 42 });
    expect(data.result).toEqual({ content: "first line of output" });
    expect(JSON.stringify(projected.payload).length).toBeLessThan(500);
  });

  it("passes task lifecycle payloads (no data field) through untouched", () => {
    const source = activity({
      taskId: "task-9",
      title: "Audit auth",
      role: "explorer",
      model: "opus",
      effort: "high",
      workflowName: "audit-flow",
      phases: [{ index: 0, title: "Audit" }],
      typedUsage: { totalTokens: 1200 },
      runHandles: { runId: "run-1", scriptPath: "/tmp/wf.js" },
      timelineBypass: true,
    });
    const projected = projectActivityPayload(source);
    expect(projected.payload).toEqual(source.payload);
  });
});

/**
 * Zerops results survive the slimming pass — the enabling seam for the Zerops
 * cards in the web client.
 *
 * The pass drops `result` from every MCP item and replaces it with the first
 * line capped at 84 characters, on the live path AND the history snapshot. That
 * is right for tool output in general and fatal for a `zerops_*` result, which
 * IS a JSON document the client renders a card from. So a bounded copy of the
 * text rides alongside, for `zerops_*` tools only.
 *
 * Plan: `../zcp/plans/z3-s6-ui-plan-2026-08-28.md` D-U1.
 */
describe("projectActivityPayload — zerops results", () => {
  const zeropsDeployText = JSON.stringify({
    status: "DEPLOYED",
    targetService: "kanbandev",
    subdomainUrl: "https://kanbandev-abc.prg1.zerops.app",
  });

  it("carries a zerops tool result verbatim while still slimming the item", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "mcp_tool_call",
        data: {
          item: {
            type: "mcpToolCall",
            server: "zerops",
            tool: "zerops_deploy",
            status: "completed",
            result: { content: [{ type: "text", text: zeropsDeployText }] },
          },
        },
      }),
    );

    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;
    const zerops = data.zerops as Record<string, unknown>;
    expect(zerops.toolName).toBe("zerops_deploy");
    expect(zerops.resultText).toBe(zeropsDeployText);

    // The existing slimming is untouched: the item's own result stays summarized.
    const item = data.item as Record<string, unknown>;
    const summarized = item.result as Record<string, unknown>;
    expect(summarized.content).not.toBe(zeropsDeployText);
  });

  /**
   * Claude emits `data = {toolName, input, result}` with no `item`, and the
   * client only reads `data.item` — so without this the browser sees NOTHING of
   * a Claude zerops call, not even the 84-character teaser.
   */
  it("carries a Claude-shaped zerops result, which has no item at all", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "mcp_tool_call",
        data: {
          toolName: "mcp__zerops__zerops_verify",
          input: { hostname: "kanbandev" },
          result: {
            type: "tool_result",
            tool_use_id: "toolu_01",
            content: [{ type: "text", text: '{"status":"healthy"}' }],
          },
        },
      }),
    );

    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;
    const zerops = data.zerops as Record<string, unknown>;
    expect(zerops.toolName).toBe("zerops_verify");
    expect(zerops.resultText).toBe('{"status":"healthy"}');
  });

  /**
   * Projection is idempotent for the card: a payload that was ALREADY projected
   * (its `result` slimmed to the teaser, its `zerops` copy riding alongside)
   * keeps that copy when projected again. The history path re-projects every
   * stored row on read, and a row persisted in projected form — every
   * non-terminal `item.updated`, and any terminal row an older server slimmed
   * before storing — has nothing left to recompute the card from. Dropping the
   * stored copy there is exactly the reopened-thread-without-cards bug.
   */
  it("keeps a stored zerops copy when the result can no longer be recomputed", () => {
    const once = projectActivityPayload(
      activity({
        itemType: "mcp_tool_call",
        data: {
          toolName: "mcp__zerops__zerops_verify",
          input: { hostname: "kanbandev" },
          result: {
            type: "tool_result",
            tool_use_id: "toolu_01",
            content: [{ type: "text", text: '{"status":"healthy"}' }],
          },
        },
      }),
    );
    const twice = projectActivityPayload(once);

    const data = (twice.payload as Record<string, unknown>).data as Record<string, unknown>;
    const zerops = data.zerops as Record<string, unknown>;
    expect(zerops.toolName).toBe("zerops_verify");
    expect(zerops.resultText).toBe('{"status":"healthy"}');
  });

  it("prefers the stored copy over recomputing from an already-slimmed result", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "mcp_tool_call",
        data: {
          toolName: "mcp__zerops__zerops_deploy",
          input: { targetService: "kanban" },
          result: {
            content: '{"status":"DEPLOYED","targetService":"kanban","subdomainUrl":"https://k…',
          },
          zerops: { toolName: "zerops_deploy", resultText: zeropsDeployText },
        },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;
    const zerops = data.zerops as Record<string, unknown>;
    expect(zerops.resultText).toBe(zeropsDeployText);
  });

  it("does not resurrect a malformed stored zerops key", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "mcp_tool_call",
        data: {
          zerops: { toolName: 42 },
        },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.zerops).toBeUndefined();
  });

  /**
   * `classifyToolItemType` tests `…delete…` before `…mcp…`, so this call is
   * typed `file_change` and takes the NON-mcp branch of the projection. The
   * hook therefore sits in `projectActivityPayload` itself, not in the mcp one.
   */
  it("carries a zerops result whose itemType Claude misclassified", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "file_change",
        data: {
          toolName: "mcp__zerops__zerops_delete",
          input: { hostname: "gone" },
          result: {
            type: "tool_result",
            tool_use_id: "toolu_02",
            content: [{ type: "text", text: '{"status":"DELETED"}' }],
          },
        },
      }),
    );

    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;
    const zerops = data.zerops as Record<string, unknown>;
    expect(zerops.toolName).toBe("zerops_delete");
    expect(zerops.resultText).toBe('{"status":"DELETED"}');
  });

  it("leaves a non-zerops MCP item exactly as it was", () => {
    const payloadOf = (a: OrchestrationThreadActivity): Record<string, unknown> =>
      a.payload as Record<string, unknown>;
    const input = activity({
      itemType: "mcp_tool_call",
      data: {
        item: {
          type: "mcpToolCall",
          server: "linear",
          tool: "create_issue",
          status: "completed",
          result: { content: [{ type: "text", text: "issue created" }] },
        },
      },
    });

    const data = payloadOf(projectActivityPayload(input)).data as Record<string, unknown>;
    expect(data.zerops).toBeUndefined();
    expect((data.item as Record<string, unknown>).tool).toBe("create_issue");
  });
});

/**
 * The Zerops result must survive on EVERY route to the browser, not only the
 * one function that attaches it. There are three, and they are the reason a
 * card can be there live and gone after a reload — or the reverse:
 *
 * - `projectActivityEvent` — the live WS path (`ws.ts:1498,1543`) AND the
 *   snapshot a client gets when it reconnects (`ws.ts:1607`);
 * - `projectThreadDetailSnapshot` — the thread-detail/history read
 *   (`orchestration/http.ts:88`), which is what a reopened thread renders from.
 *
 * All three go through `projectActivityPayload`, so these tests are about the
 * wiring holding rather than the rule differing.
 */
describe("zerops results survive every route to the client", () => {
  const zeropsActivity = () =>
    activity({
      itemType: "mcp_tool_call",
      data: {
        toolName: "mcp__zerops__zerops_verify",
        input: { hostname: "kanbandev" },
        result: {
          type: "tool_result",
          tool_use_id: "toolu_01",
          content: [{ type: "text", text: '{"status":"healthy"}' }],
        },
      },
    });

  const zeropsOf = (projected: OrchestrationThreadActivity): Record<string, unknown> => {
    const payload = projected.payload as Record<string, unknown>;
    const data = payload.data as Record<string, unknown>;
    return data.zerops as Record<string, unknown>;
  };

  it("carries it on the live event path", () => {
    const event = projectActivityEvent({
      type: "thread.activity-appended",
      payload: { activity: zeropsActivity() },
    } as unknown as OrchestrationEvent);

    const projected = (event as unknown as { payload: { activity: OrchestrationThreadActivity } })
      .payload.activity;
    expect(zeropsOf(projected).resultText).toBe('{"status":"healthy"}');
  });

  it("carries it on the thread-detail snapshot a reopened thread renders from", () => {
    const snapshot = projectThreadDetailSnapshot({
      thread: { activities: [zeropsActivity()] },
    } as unknown as OrchestrationThreadDetailSnapshot);

    const projected = (
      snapshot as unknown as { thread: { activities: OrchestrationThreadActivity[] } }
    ).thread.activities[0]!;
    expect(zeropsOf(projected).resultText).toBe('{"status":"healthy"}');
  });

  /** An event that is not an appended activity passes through untouched. */
  it("leaves an unrelated event alone", () => {
    const event = {
      type: "thread.updated",
      payload: { anything: true },
    } as unknown as OrchestrationEvent;

    expect(projectActivityEvent(event)).toBe(event);
  });
});
