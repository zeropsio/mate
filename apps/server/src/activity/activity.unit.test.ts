import { expect, it } from "@effect/vitest";
import {
  EventId,
  ProviderDriverKind,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type OrchestrationThreadActivity,
  type SpiEvent,
  type SpiToolCall,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { makeBrowserCallFrames } from "../zerops/ZeropsBrowserCallFrames.ts";
import { make, type CompletedWrite } from "../zerops/ThreadFileWrites.ts";
import { readFileWrites } from "../zerops/fileWrites.ts";
import { projectActivityPayload } from "./ActivityPayloadProjection.ts";
import { ZEROPS_RESULT_TEXT_LIMIT, projectZeropsResult } from "./zeropsActivityResult.ts";

// witness: apps/server/src/activity/ActivityPayloadProjection.ts | "description", → "description", "content",
it("AC1: A stored Write keeps the file's path and never the file's content", () => {
  const stored = {
    id: "activity-1",
    tone: "tool",
    kind: "tool.completed",
    summary: "Tool",
    payload: {
      itemType: "file_change",
      data: {
        toolName: "Write",
        input: { file_path: "/var/www/notes.md", content: "c".repeat(10_000) },
      },
    },
    turnId: null,
    createdAt: "2026-08-01T10:00:00.000Z",
  } as unknown as OrchestrationThreadActivity;
  const inputOf = (projected: OrchestrationThreadActivity) =>
    (projected.payload as { data: Record<string, unknown> }).data.input;
  // The history path re-projects each stored row on read; a streamed row is stored projected.
  const once = projectActivityPayload(stored);
  expect(inputOf(once)).toEqual({ file_path: "/var/www/notes.md" });
  expect(inputOf(projectActivityPayload(once))).toEqual({ file_path: "/var/www/notes.md" });
});

// witness: apps/server/src/activity/zeropsActivityResult.ts | return call.result.text.length > ZEROPS_RESULT_TEXT_LIMIT → return call.result.text.length > ZEROPS_RESULT_TEXT_LIMIT + 1
it("AC2: A Zerops tool result whose text exceeds the stored cap is kept without its text and marked truncated, never cut mid-document", () => {
  const toolCall: SpiToolCall = {
    name: "zerops_deploy",
    rawName: "mcp__zerops__zerops_deploy",
    arguments: { hostname: "kanbandev" },
    result: { text: "x".repeat(ZEROPS_RESULT_TEXT_LIMIT + 1), failed: false },
  };
  const projected = projectZeropsResult({ toolCall } as SpiEvent);
  expect(projected?.toolName).toBe("zerops_deploy");
  expect(projected?.resultText).toBeUndefined();
  expect(projected?.truncated).toBe(true);
});

// witness: apps/server/src/zerops/ThreadFileWrites.ts | wrote(row.payload) && readFileWritePaths(asRecord(row.payload)?.data).includes(path), → readFileWritePaths(asRecord(row.payload)?.data).includes(path),
it.effect(
  "AC3: A written file is read back only for a path a completed, successful write of that conversation named exactly: another path, the path with a space added, the path named another way, or a path only a failed, declined or unreturned call named is refused as not written, and a relative path as not absolute",
  () =>
    Effect.gen(function* () {
      const writePayload = (path: string) => ({
        itemType: "file_change",
        status: "completed",
        data: { toolName: "Write", input: { file_path: path, content: "x" } },
      });
      const writes: CompletedWrite[] = [
        { payload: writePayload("/home/u/plan.md"), completedAt: "2026-10-06T10:00:01.000Z" },
        {
          payload: { ...writePayload("/home/u/failed.md"), status: "failed" },
          completedAt: "2026-10-06T10:00:02.000Z",
        },
        {
          payload: { ...writePayload("/home/u/declined.md"), status: "declined" },
          completedAt: "2026-10-06T10:00:03.000Z",
        },
        {
          payload: { ...writePayload("/home/u/unreturned.md"), unreturned: true },
          completedAt: "2026-10-06T10:00:04.000Z",
        },
        { payload: writePayload("/home/u/.claude.json "), completedAt: "2026-10-06T10:00:05.000Z" },
      ];
      const service = make({
        completedWrites: () => Effect.succeed(writes),
        callPayloads: () => Effect.succeed([]),
      });
      for (const [path, refused] of [
        ["/home/u/other.md", "not_written"],
        ["/home/u/plan.md ", "not_written"],
        ["/home/u/./plan.md", "not_written"],
        ["plan.md", "not_absolute"],
        ["/home/u/failed.md", "not_written"],
        ["/home/u/declined.md", "not_written"],
        ["/home/u/unreturned.md", "not_written"],
        ["/home/u/.claude.json ", "not_written"],
      ] as const) {
        const answer = yield* service
          .writtenFile({ threadId: ThreadId.make("thread-writes"), path })
          .pipe(
            Effect.map((file) => ({ shown: file }) as const),
            Effect.catchTags({
              ThreadFileWritesError: (error) => Effect.succeed({ refused: error.reason } as const),
            }),
          );
        expect({ path, answer }).toEqual({ path, answer: { refused } });
      }
    }),
);

// witness: apps/server/src/zerops/ZeropsBrowserCallFrames.ts | completeness: "partial" → completeness: "complete"
it("AC4: A browser call's result seen with no subscriber and no captured image is reported partial, never as proof that the call had no image", () => {
  const tracker = makeBrowserCallFrames();
  const completed: SpiEvent = {
    type: "item.completed",
    eventId: EventId.make("call:item.completed"),
    threadId: ThreadId.make("thread"),
    turnId: TurnId.make("turn"),
    provider: ProviderDriverKind.make("codex"),
    itemId: RuntimeItemId.make("call"),
    createdAt: "2026-10-07T00:00:00Z",
    payload: { itemType: "mcp_tool_call" },
    toolCall: {
      name: "zerops_browser",
      rawName: "zerops_browser",
      result: { text: "done", failed: false },
    },
  };
  expect(tracker.ingest(completed)).toEqual({
    type: "call-result",
    callId: "call",
    threadId: "thread",
    turnId: "turn",
    revision: 1,
    completeness: "partial",
  });
});

// witness: apps/server/src/zerops/fileWrites.ts | return typeof value === "string" && value.trim().length > 0 ? value : null; → return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
it("AC5: A written file's path is kept exactly as the call named it, a leading space included", () => {
  const [write] = readFileWrites({
    toolName: "Write",
    input: { file_path: " /srv/a.md", content: "a" },
  });
  expect(write?.path).toBe(" /srv/a.md");
});

// witness: apps/server/src/activity/ActivityPayloadProjection.ts | payload.status === "completed" && (itemStatus === "failed" || itemStatus === "declined") → payload.status === "completed" && itemStatus === "declined"
it("AC6: A stored command or MCP tool call whose item failed keeps the status failed after projection, even when the call itself reported completed", () => {
  const stored = (
    id: string,
    itemType: string,
    item: Record<string, unknown>,
  ): OrchestrationThreadActivity => ({
    id: EventId.make(id),
    tone: "tool",
    kind: "tool.completed",
    summary: `Completed ${itemType}`,
    payload: {
      itemType,
      title: itemType,
      detail: `${itemType} detail`,
      status: "completed",
      requestKind: "command",
      data: { item },
    },
    turnId: TurnId.make(`turn-${id}`),
    createdAt: "2026-07-27T00:00:00.000Z",
  });
  for (const activity of [
    stored("failed-command", "command_execution", {
      command: "vp test run",
      exitCode: 1,
      status: "failed",
    }),
    stored("failed-mcp", "mcp_tool_call", {
      server: "simulator",
      tool: "build",
      arguments: {},
      status: "failed",
    }),
  ]) {
    const projected = projectActivityPayload(activity);
    expect((projected.payload as { status: unknown }).status).toBe("failed");
  }
});
