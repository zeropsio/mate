import { describe, expect, it } from "vite-plus/test";
import type {
  OrchestrationEvent,
  OrchestrationThread,
  OrchestrationThreadActivity,
  OrchestrationThreadDetailSnapshot,
} from "@t3tools/contracts";

// The live half of the parity check below: the client's own reducer, which a
// reload's snapshot must agree with.
import { applyThreadDetailEvent } from "../../../../packages/client-runtime/src/state/threadReducer.ts";
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
  it.each([
    "",
    ":source-missing",
    ":source-changed",
    ":storage-full",
    ":unsupported",
    ":persistence-failed",
  ])(
    "keeps a captured tool image reference through live events, reload and repeated projection: %s",
    (failure) => {
      const imagePath = `mate-asset:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa${failure}`;
      const source = activity({
        itemType: "dynamic_tool_call",
        data: {
          toolName: "Read",
          input: { file_path: "/tmp/old.png" },
          imagePath,
        },
      });
      const once = projectActivityPayload(source);
      expect(once.payload).toMatchObject({ data: { imagePath } });
      expect(projectActivityPayload(once).payload).toMatchObject({ data: { imagePath } });
      const event = projectActivityEvent({
        type: "thread.activity-appended",
        payload: { activity: source },
      } as unknown as OrchestrationEvent);
      expect(event).toMatchObject({ payload: { activity: { payload: { data: { imagePath } } } } });
      const snapshot = projectThreadDetailSnapshot({
        thread: { messages: [], activities: [source] },
      } as unknown as OrchestrationThreadDetailSnapshot);
      expect(snapshot).toMatchObject({
        thread: { activities: [{ payload: { data: { imagePath } } }] },
      });
    },
  );

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

  it("keeps bounded Claude command input and result summaries", () => {
    const claude = projectActivityPayload(
      activity({
        itemType: "command_execution",
        toolCallId: "claude-call-1",
        data: {
          toolName: "Bash",
          input: { command: "vp test run" },
          result: {
            type: "tool_result",
            content: [
              { type: "text", text: "tests passed" },
              { type: "text", text: "x".repeat(5_000) },
            ],
          },
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
      data: {
        toolName: "Bash",
        command: "vp test run",
        rawOutput: { content: "tests passed" },
      },
    });
    expect(openCode.payload).toMatchObject({
      toolCallId: "opencode-call-1",
      data: { command: "vp lint" },
    });
    expect(JSON.stringify(claude.payload).length).toBeLessThan(250);
    expect(JSON.stringify(openCode.payload).length).toBeLessThan(200);
  });

  it("keeps full Claude Read image paths through repeated projection", () => {
    const imagePath = `/workspace/${"nested folder/".repeat(16)}reference image.webp`;
    const projected = projectActivityPayload(
      activity({
        itemType: "dynamic_tool_call",
        detail: 'Read: {"file_path":"truncated..."}',
        data: {
          toolName: "Read",
          input: { file_path: imagePath },
          result: { content: "Image Size: 1280x720." },
        },
      }),
    );
    const projectedAgain = projectActivityPayload(projected);

    expect(projected.payload).toMatchObject({ data: { imagePath } });
    expect(projectedAgain.payload).toMatchObject({ data: { imagePath } });

    const textRead = projectActivityPayload(
      activity({
        itemType: "dynamic_tool_call",
        data: { toolName: "Read", input: { file_path: "/workspace/src/index.ts" } },
      }),
    );
    expect(textRead.payload).not.toMatchObject({ data: { imagePath: expect.anything() } });
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

  /**
   * A tool call's own words: Claude gives every Bash call a one-line
   * `description`, and the other tools name their target in their input. The
   * slimming keeps that whitelist for a non-MCP call — never the bodies
   * (`content`, `old_string`, `new_string`, `prompt`), which can be huge, and
   * never `command`, which already rides at `data.command`. Every row is
   * projected twice: the history path re-projects each stored row on read,
   * and a streamed `tool.updated` is stored already projected.
   */
  it.each([
    {
      name: "a Bash call keeps its description beside the command",
      itemType: "command_execution",
      toolName: "Bash",
      input: { command: "vp test run", description: "Run the targeted tests", timeout: 60_000 },
      expected: { description: "Run the targeted tests" },
    },
    {
      name: "a Read keeps its file_path",
      itemType: "dynamic_tool_call",
      toolName: "Read",
      input: { file_path: "/var/www/src/index.ts", offset: 10, limit: 40 },
      expected: { file_path: "/var/www/src/index.ts" },
    },
    {
      name: "an Edit keeps its file_path and never the strings it swaps",
      itemType: "file_change",
      toolName: "Edit",
      input: {
        file_path: "/var/www/src/app.ts",
        old_string: "a".repeat(5_000),
        new_string: "b".repeat(5_000),
      },
      expected: { file_path: "/var/www/src/app.ts" },
    },
    {
      name: "a Write keeps its file_path and never the content",
      itemType: "file_change",
      toolName: "Write",
      input: { file_path: "/var/www/notes.md", content: "c".repeat(10_000) },
      expected: { file_path: "/var/www/notes.md" },
    },
    {
      name: "a Grep keeps its pattern, path and glob",
      itemType: "dynamic_tool_call",
      toolName: "Grep",
      input: { pattern: "TODO", path: "/var/www/src", glob: "*.ts", output_mode: "content" },
      expected: { pattern: "TODO", path: "/var/www/src", glob: "*.ts" },
    },
    {
      name: "a WebFetch keeps its url and never the prompt",
      itemType: "dynamic_tool_call",
      toolName: "WebFetch",
      input: { url: "https://example.com/docs", prompt: "Summarize the page. ".repeat(200) },
      expected: { url: "https://example.com/docs" },
    },
    {
      name: "a WebSearch keeps its query",
      itemType: "web_search",
      toolName: "WebSearch",
      input: { query: "zerops yaml reference", allowed_domains: ["example.com"] },
      expected: { query: "zerops yaml reference" },
    },
    {
      name: "a subagent keeps its description and never its prompt",
      itemType: "collab_agent_tool_call",
      toolName: "Agent",
      input: {
        description: "Audit the fold",
        prompt: "p".repeat(5_000),
        subagent_type: "explorer",
      },
      expected: { description: "Audit the fold" },
    },
    {
      // F6: the name the Mate gave its helper is what its own text calls it.
      name: "a subagent keeps the name the Mate gave it",
      itemType: "collab_agent_tool_call",
      toolName: "Agent",
      input: {
        description: "Build the scene",
        prompt: "p".repeat(5_000),
        name: "deep-sea-builder",
      },
      expected: { description: "Build the scene", name: "deep-sea-builder" },
    },
    {
      name: "any other call's name is not its own words",
      itemType: "dynamic_tool_call",
      toolName: "Skill",
      input: { description: "Read the guide", name: "zerops-guide" },
      expected: { description: "Read the guide" },
    },
    {
      name: "a kept value is trimmed, and a blank or non-string one is dropped",
      itemType: "command_execution",
      toolName: "Bash",
      input: {
        command: "ls",
        description: "  List the shots  ",
        path: 42,
        pattern: ["a"],
        query: "   ",
      },
      expected: { description: "List the shots" },
    },
    {
      name: "a long value is capped at 300 characters with an ellipsis",
      itemType: "command_execution",
      toolName: "Bash",
      input: { command: "ls", description: `${"d".repeat(1_000)}  ` },
      expected: { description: `${"d".repeat(299)}…` },
    },
    {
      name: "an input naming none of the kept keys leaves data.input out",
      itemType: "dynamic_tool_call",
      toolName: "TodoWrite",
      input: { todos: [{ content: "Ship", status: "pending" }] },
      expected: undefined,
    },
    {
      name: "an MCP call keeps its whole input, as before",
      itemType: "mcp_tool_call",
      toolName: "mcp__github__create_issue",
      input: { title: "Broken link", body: "b".repeat(2_000), query: "q" },
      expected: { title: "Broken link", body: "b".repeat(2_000), query: "q" },
    },
  ])("$name", ({ itemType, toolName, input, expected }) => {
    const dataOf = (projected: OrchestrationThreadActivity) =>
      (projected.payload as { data: Record<string, unknown> }).data;
    const once = projectActivityPayload(activity({ itemType, data: { toolName, input } }));
    const twice = projectActivityPayload(once);

    expect(dataOf(once).input).toEqual(expected);
    expect(dataOf(twice).input).toEqual(expected);
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

/**
 * The description reaches the client on the live path and on every read of
 * history. A `tool.completed` row is stored with the full payload and the
 * snapshot query projects it at read time, so a run recorded before this
 * projection kept the description gets it back on the next read.
 */
describe("a tool call's own words survive every route to the client", () => {
  const storedBashCompletion = () =>
    activity({
      itemType: "command_execution",
      toolCallId: "toolu_bash_1",
      data: {
        toolName: "Bash",
        input: {
          command: "agent-browser screenshot /home/zerops/shots/home.png",
          description: "Screenshot the home page",
        },
        result: {
          type: "tool_result",
          tool_use_id: "toolu_bash_1",
          content: [{ type: "text", text: `Saved\n${"x".repeat(5_000)}` }],
        },
      },
    });

  const inputOf = (projected: OrchestrationThreadActivity): unknown =>
    (projected.payload as { data: Record<string, unknown> }).data.input;

  it("carries it on the live event path", () => {
    const event = projectActivityEvent({
      type: "thread.activity-appended",
      payload: { activity: storedBashCompletion() },
    } as unknown as OrchestrationEvent);

    const projected = (event as unknown as { payload: { activity: OrchestrationThreadActivity } })
      .payload.activity;
    expect(inputOf(projected)).toEqual({ description: "Screenshot the home page" });
  });

  it("carries it on a stored tool.completed row the snapshot query projects", () => {
    const projected = projectActivityPayload(storedBashCompletion());

    expect(inputOf(projected)).toEqual({ description: "Screenshot the home page" });
    expect(projected.payload).toMatchObject({
      data: { command: "agent-browser screenshot /home/zerops/shots/home.png" },
    });
  });

  it("carries it on the thread-detail snapshot a reopened thread renders from", () => {
    const snapshot = projectThreadDetailSnapshot({
      thread: { messages: [], activities: [storedBashCompletion()] },
    } as unknown as OrchestrationThreadDetailSnapshot);

    const projected = (
      snapshot as unknown as { thread: { activities: OrchestrationThreadActivity[] } }
    ).thread.activities[0]!;
    expect(inputOf(projected)).toEqual({ description: "Screenshot the home page" });
  });
});

/**
 * A reload paints what the live run painted. An ACP call never starts: its
 * first `tool.updated` is where the run first saw it, so its step starts and
 * stands there; once completed, the updates between say nothing more.
 */
describe("a reopened thread keeps where each call started", () => {
  const row = (
    id: string,
    kind: string,
    toolCallId: string,
    createdAt: string,
  ): OrchestrationThreadActivity =>
    ({
      id,
      tone: "tool",
      kind,
      summary: "Read file",
      payload: { itemType: "dynamic_tool_call", toolCallId, status: "inProgress" },
      turnId: "turn-1",
      createdAt,
    }) as unknown as OrchestrationThreadActivity;

  const keptIds = (activities: ReadonlyArray<OrchestrationThreadActivity>) =>
    (
      projectThreadDetailSnapshot({
        thread: { messages: [], activities },
      } as unknown as OrchestrationThreadDetailSnapshot) as unknown as {
        thread: { activities: OrchestrationThreadActivity[] };
      }
    ).thread.activities.map((activity) => activity.id);

  it.each([
    {
      name: "a call seen first as an update keeps that update",
      activities: [
        row("u1", "tool.updated", "call-1", "2026-10-03T10:00:00.000Z"),
        row("u2", "tool.updated", "call-1", "2026-10-03T10:00:04.000Z"),
        row("c1", "tool.completed", "call-1", "2026-10-03T10:00:09.000Z"),
      ],
      kept: ["u1", "c1"],
    },
    {
      name: "a call that started drops every update",
      activities: [
        row("s1", "tool.started", "call-1", "2026-10-03T10:00:00.000Z"),
        row("u1", "tool.updated", "call-1", "2026-10-03T10:00:01.000Z"),
        row("c1", "tool.completed", "call-1", "2026-10-03T10:00:09.000Z"),
      ],
      kept: ["s1", "c1"],
    },
    {
      name: "interleaved calls each keep their first sight",
      activities: [
        row("a1", "tool.updated", "call-a", "2026-10-03T10:00:00.000Z"),
        row("b1", "tool.updated", "call-b", "2026-10-03T10:00:01.000Z"),
        row("a2", "tool.updated", "call-a", "2026-10-03T10:00:02.000Z"),
        row("ac", "tool.completed", "call-a", "2026-10-03T10:00:03.000Z"),
        row("bc", "tool.completed", "call-b", "2026-10-03T10:00:04.000Z"),
      ],
      kept: ["a1", "b1", "ac", "bc"],
    },
  ])("$name", ({ activities, kept }) => {
    expect(keptIds(activities)).toEqual(kept);
  });
});

/**
 * Every driver's call reaches the client in one form: the tool's name at
 * `data.toolName`, what it names at `data.input` in Claude's keys, the files
 * it touched at `data.files`, a picture it looked at at `data.imagePath`, and
 * a Zerops call's result at `data.zerops` — OpenCode's `{tool, state}` and an
 * ACP agent's `{toolCallId, kind, rawInput, ...}` as much as Claude's own.
 */
describe("every driver's call reaches the client in one form", () => {
  const call = (
    summary: string,
    payload: Record<string, unknown>,
    kind = "tool.completed",
  ): OrchestrationThreadActivity =>
    ({
      id: "activity-1",
      tone: "tool",
      kind,
      summary,
      payload,
      turnId: null,
      createdAt: "2026-10-03T10:00:00.000Z",
    }) as unknown as OrchestrationThreadActivity;

  const dataOf = (activity: OrchestrationThreadActivity) =>
    (projectActivityPayload(activity).payload as { data: Record<string, unknown> }).data;

  it.each([
    {
      name: "an OpenCode read",
      activity: call("src/app.ts", {
        itemType: "dynamic_tool_call",
        status: "completed",
        data: {
          tool: "read",
          state: { status: "completed", input: { filePath: "/app/src/app.ts" }, output: "x" },
        },
      }),
      expected: { toolName: "read", input: { file_path: "/app/src/app.ts" } },
    },
    {
      name: "an OpenCode grep",
      activity: call("TODO", {
        itemType: "dynamic_tool_call",
        status: "completed",
        data: {
          tool: "grep",
          state: { status: "completed", input: { pattern: "TODO", path: "src" }, output: "" },
        },
      }),
      expected: { toolName: "grep", input: { pattern: "TODO", path: "src" } },
    },
    {
      name: "an OpenCode Zerops call",
      activity: call("zerops_zerops_deploy", {
        itemType: "dynamic_tool_call",
        status: "completed",
        data: {
          tool: "zerops_zerops_deploy",
          state: {
            status: "completed",
            input: { targetService: "api", strategy: "push" },
            output: '{"status":"FINISHED"}',
          },
        },
      }),
      expected: {
        toolName: "mcp__zerops__zerops_deploy",
        input: { targetService: "api", strategy: "push" },
        zerops: { toolName: "zerops_deploy", resultText: '{"status":"FINISHED"}' },
      },
    },
    {
      name: "an ACP read, named by its kind and its file by its location",
      activity: call("Read file", {
        itemType: "dynamic_tool_call",
        status: "completed",
        detail: "/app/src/app.ts",
        data: {
          toolCallId: "call-1",
          kind: "read",
          rawInput: { path: "/app/src/app.ts" },
          locations: [{ path: "/app/src/app.ts" }],
        },
      }),
      expected: {
        toolName: "read",
        input: { path: "/app/src/app.ts", file_path: "/app/src/app.ts" },
        files: [{ path: "/app/src/app.ts" }],
      },
    },
    {
      name: "an ACP edit, its file by its location",
      activity: call("Changed files", {
        itemType: "file_change",
        status: "completed",
        data: { toolCallId: "call-2", kind: "edit", locations: [{ path: "/app/src/app.ts" }] },
      }),
      expected: {
        toolName: "edit",
        input: { file_path: "/app/src/app.ts" },
        files: [{ path: "/app/src/app.ts" }],
      },
    },
    {
      name: "an ACP look at a picture",
      activity: call("Read file", {
        itemType: "dynamic_tool_call",
        status: "completed",
        data: { toolCallId: "call-3", kind: "read", locations: [{ path: "/app/shot.png" }] },
      }),
      expected: {
        toolName: "read",
        input: { file_path: "/app/shot.png" },
        imagePath: "/app/shot.png",
        files: [{ path: "/app/shot.png" }],
      },
    },
    {
      name: "an ACP Zerops call, named by its title",
      activity: call("Running zerops_deploy", {
        itemType: "dynamic_tool_call",
        status: "completed",
        data: {
          toolCallId: "call-4",
          kind: "other",
          rawInput: { targetService: "api" },
          rawOutput: { content: [{ type: "text", text: '{"status":"FINISHED"}' }] },
        },
      }),
      expected: {
        toolName: "mcp__zerops__zerops_deploy",
        input: { targetService: "api" },
        zerops: { toolName: "zerops_deploy", resultText: '{"status":"FINISHED"}' },
      },
    },
    // An MCP tool keeps its server: it is never taken for a native tool of
    // its name, and a native tool is never taken for an MCP one.
    {
      name: "an OpenCode MCP tool named as a native one",
      activity: call("db_execute", {
        itemType: "dynamic_tool_call",
        status: "completed",
        data: {
          tool: "db_execute",
          state: { status: "completed", input: { sql: "select 1" }, output: "1" },
        },
      }),
      expected: { toolName: "mcp__db__execute" },
    },
    {
      name: "OpenCode's own underscored tool",
      activity: call("plan_exit", {
        itemType: "dynamic_tool_call",
        status: "completed",
        data: { tool: "plan_exit", state: { status: "completed", input: {}, output: "" } },
      }),
      expected: { toolName: "plan_exit" },
    },
    {
      name: "an ACP Zerops call its agent tagged as a command",
      activity: call("Ran command", {
        itemType: "command_execution",
        status: "completed",
        data: {
          toolCallId: "call-5",
          kind: "execute",
          title: "mcp__zerops__zerops_deploy",
          rawInput: { targetService: "api" },
          rawOutput: { content: [{ type: "text", text: '{"status":"FINISHED"}' }] },
        },
      }),
      expected: {
        toolName: "mcp__zerops__zerops_deploy",
        input: { targetService: "api" },
        zerops: { toolName: "zerops_deploy", resultText: '{"status":"FINISHED"}' },
      },
    },
    {
      name: "an ACP search of the web",
      activity: call("Searched files", {
        itemType: "web_search",
        status: "completed",
        data: { toolCallId: "call-6", kind: "search", rawInput: { query: "zerops yaml" } },
      }),
      expected: { toolName: "websearch", input: { query: "zerops yaml" } },
    },
  ])("$name", ({ activity, expected }) => {
    const data = dataOf(activity);
    expect(data).toMatchObject(expected);
    // A reread of history projects the projected row again: it reads the same.
    expect(dataOf({ ...activity, payload: projectActivityPayload(activity).payload })).toEqual(
      data,
    );
  });

  it("names nothing a Codex command never named", () => {
    const data = dataOf(
      call("Ran command", {
        itemType: "command_execution",
        data: { item: { type: "commandExecution", command: "ls" } },
      }),
    );
    expect(data.toolName).toBeUndefined();
  });
});

/**
 * A provider sends a call's last update with its completion: the same instant,
 * the same payload but its status. With no sequence, rows of one instant sort
 * by their random ids, so the echo lands before or after the completion — in
 * the live stream and in the stored history alike. Run 12: every browser
 * check's screenshot rode in both, and Sage's thread held 22 pictures twice on
 * reload and 55 live. A reload drops the echo wherever it sorts, the live
 * reducer drops it in whatever order it arrives, and the two agree.
 */
describe("a call's echoed update goes, live and on reload alike", () => {
  const AT = "2026-10-05T21:54:17.030Z";
  const PICTURE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";
  /** A zerops_browser call as Claude's adapter writes it: the raw tool_result, screenshot block included. */
  const payloadOf = (kind: string, output: string) => ({
    itemType: "mcp_tool_call",
    toolCallId: "toolu_1",
    status: kind === "tool.completed" ? "completed" : "inProgress",
    detail: 'mcp__zerops__zerops_browser: {"url":"https://app.example/"}',
    data: {
      toolName: "mcp__zerops__zerops_browser",
      input: { url: "https://app.example/", screenshot: true },
      ...(kind === "tool.started"
        ? {}
        : {
            result: {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [
                { type: "text", text: output },
                {
                  type: "image",
                  source: { type: "base64", media_type: "image/png", data: PICTURE },
                },
              ],
            },
          }),
    },
  });
  type Row = readonly [id: string, kind: string, createdAt?: string, output?: string];
  const rowOf = ([id, kind, createdAt = AT, output = '{"status":"ok"}']: Row) =>
    ({
      id,
      tone: "tool",
      kind,
      summary: "MCP tool call",
      payload: payloadOf(kind, output),
      turnId: "turn-1",
      createdAt,
    }) as unknown as OrchestrationThreadActivity;

  const pictureOf = (activity: OrchestrationThreadActivity | undefined) =>
    (activity?.payload as { data?: { zerops?: { images?: Array<{ data: string }> } } } | undefined)
      ?.data?.zerops?.images?.[0]?.data;

  /**
   * What a reload shows: each row as stored — a streamed update projected as
   * it was written, the rest raw — read back projected by the snapshot query
   * in its order (sequence, instant, id), then projected by the snapshot.
   */
  const reloaded = (rows: ReadonlyArray<Row>) =>
    (
      projectThreadDetailSnapshot({
        thread: {
          messages: [],
          activities: rows
            .map(rowOf)
            .map((row) => (row.kind === "tool.updated" ? projectActivityPayload(row) : row))
            .map(projectActivityPayload)
            .toSorted(
              (left, right) =>
                (left.sequence ?? -1) - (right.sequence ?? -1) ||
                left.createdAt.localeCompare(right.createdAt) ||
                left.id.localeCompare(right.id),
            ),
        },
      } as unknown as OrchestrationThreadDetailSnapshot) as unknown as {
        thread: { activities: OrchestrationThreadActivity[] };
      }
    ).thread.activities;
  const reload = (rows: ReadonlyArray<Row>) => reloaded(rows).map((activity) => activity.id);

  /** What a live page shows: each row's event as the socket sends it, folded by the client's reducer in the order it arrived. */
  const lived = (rows: ReadonlyArray<Row>) =>
    rows.reduce<OrchestrationThread>(
      (thread, row, index) => {
        const event = projectActivityEvent({
          sequence: index + 1,
          eventId: `event-${index}`,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          occurredAt: AT,
          aggregateKind: "thread",
          aggregateId: "thread-1",
          type: "thread.activity-appended",
          payload: { threadId: "thread-1", activity: rowOf(row) },
        } as unknown as OrchestrationEvent);
        const result = applyThreadDetailEvent(thread, event);
        return result.kind === "updated" ? result.thread : thread;
      },
      { id: "thread-1", activities: [], messages: [] } as unknown as OrchestrationThread,
    ).activities;
  const live = (rows: ReadonlyArray<Row>) => lived(rows).map((activity) => activity.id);

  const START: Row = ["m-start", "tool.started", "2026-10-05T21:54:00.000Z"];
  const permutations = <T>(items: ReadonlyArray<T>): T[][] =>
    items.length <= 1
      ? [[...items]]
      : items.flatMap((item, index) =>
          permutations(items.filter((_, other) => other !== index)).map((rest) => [item, ...rest]),
        );

  it.each([
    { name: "a started call, its echo sorting before the completion", echo: "b-echo", start: true },
    { name: "a started call, its echo sorting after the completion", echo: "x-echo", start: true },
    { name: "a call with no start, its echo sorting before", echo: "b-echo", start: false },
    { name: "a call with no start, its echo sorting after", echo: "x-echo", start: false },
  ])("$name, in every order it arrives", ({ echo, start }) => {
    const rows: Row[] = [
      ...(start ? [START] : []),
      [echo, "tool.updated"],
      ["c-done", "tool.completed"],
    ];
    const expected = start ? ["m-start", "c-done"] : ["c-done"];
    expect(reload(rows)).toEqual(expected);
    // The projection read the screenshot out of the raw result: the kept
    // completion carries it, live and on reload.
    expect(pictureOf(reloaded(rows).at(-1))).toBe(PICTURE);
    for (const arrival of permutations(rows)) {
      expect(live(arrival)).toEqual(expected);
      expect(pictureOf(lived(arrival).at(-1))).toBe(PICTURE);
    }
  });

  it.each([
    {
      name: "an update with new output after the completion stays (late output)",
      rows: [
        START,
        ["c-done", "tool.completed"],
        ["u-late", "tool.updated", "2026-10-05T21:54:18.000Z", '{"status":"ok","more":true}'],
      ] satisfies Row[],
      kept: ["m-start", "c-done", "u-late"],
    },
    {
      name: "an update with other output at the completion's instant, after it, stays",
      rows: [
        START,
        ["c-done", "tool.completed"],
        ["x-other", "tool.updated", AT, '{"status":"partial"}'],
      ] satisfies Row[],
      kept: ["m-start", "c-done", "x-other"],
    },
  ])("$name", ({ rows, kept }) => {
    expect(reload(rows)).toEqual(kept);
    expect(live(rows)).toEqual(kept);
  });
});

describe("a call that wrote a file says so, and only then", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly payload: Record<string, unknown>;
    readonly wrote: boolean;
  }> = [
    {
      name: "Claude Write",
      payload: {
        itemType: "file_change",
        data: { toolName: "Write", input: { file_path: "/srv/a.md", content: "# A" } },
      },
      wrote: true,
    },
    {
      name: "Codex file change",
      payload: {
        itemType: "file_change",
        data: {
          item: {
            type: "fileChange",
            changes: [{ path: "/srv/a.ts", kind: { type: "add" }, diff: "x" }],
          },
        },
      },
      wrote: true,
    },
    {
      name: "an ACP edit with a diff",
      payload: {
        itemType: "file_change",
        data: {
          kind: "edit",
          content: [{ type: "diff", path: "/srv/a.ts", oldText: "a", newText: "b" }],
        },
      },
      wrote: true,
    },
    {
      name: "an ACP edit without one",
      payload: { itemType: "file_change", data: { kind: "edit", locations: [{ path: "/a" }] } },
      wrote: false,
    },
    {
      name: "a read",
      payload: {
        itemType: "dynamic_tool_call",
        data: { toolName: "Read", input: { file_path: "/srv/a.ts" } },
      },
      wrote: false,
    },
  ];

  it.each(cases)("$name", ({ payload, wrote }) => {
    const once = projectActivityPayload(activity(payload));
    const data = (once.payload as { data: Record<string, unknown> }).data;
    expect(data.wrote === true).toBe(wrote);
    // What it wrote stays on the server: the row asks for it when it opens.
    expect(JSON.stringify(data)).not.toMatch(/"content":"# A"|"newText"|"diff":"x"/u);
    // A stored row already projected (a streamed update) keeps the mark.
    const twice = projectActivityPayload(once);
    expect((twice.payload as { data: Record<string, unknown> }).data.wrote === true).toBe(wrote);
  });
});
