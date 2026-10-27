import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isToolCallEcho } from "./toolCallEcho.ts";

const AT = "2026-10-05T21:54:17.030Z";

const row = (
  kind: string,
  payload: Record<string, unknown>,
  overrides: Partial<Record<"createdAt" | "turnId", string>> = {},
): OrchestrationThreadActivity =>
  ({
    id: `${kind}-row`,
    tone: "tool",
    kind,
    summary: "MCP tool call",
    payload,
    turnId: overrides.turnId ?? "turn-1",
    createdAt: overrides.createdAt ?? AT,
  }) as unknown as OrchestrationThreadActivity;

const result = (status: string, images = ["abc123"]) => ({
  itemType: "mcp_tool_call",
  toolCallId: "toolu_1",
  status,
  data: {
    toolName: "mcp__zerops__zerops_browser",
    zerops: { images: images.map((data) => ({ mimeType: "image/png", data })) },
  },
});

describe("isToolCallEcho — the update a provider sends with a call's completion", () => {
  it.each([
    {
      name: "the completion's payload at its instant, only its status in progress",
      update: row("tool.updated", result("inProgress")),
      echo: true,
    },
    {
      name: "the completion's payload whole, its status too",
      update: row("tool.updated", result("completed")),
      echo: true,
    },
    {
      name: "new output at the completion's instant",
      update: row("tool.updated", result("inProgress", ["def456"])),
      echo: false,
    },
    {
      name: "the same payload a moment later",
      update: row("tool.updated", result("inProgress"), { createdAt: "2026-10-05T21:54:17.031Z" }),
      echo: false,
    },
    {
      name: "the same payload in another turn",
      update: row("tool.updated", result("inProgress"), { turnId: "turn-2" }),
      echo: false,
    },
    {
      name: "another call's update",
      update: row("tool.updated", { ...result("inProgress"), toolCallId: "toolu_2" }),
      echo: false,
    },
    {
      // p43/files marks a write or edit call `data.wrote` as it projects it. An
      // update stored before that release has no mark, while its completion,
      // stored whole, gains it on every read.
      name: "an update stored before the write mark, against a completion that gains it",
      update: row("tool.updated", result("inProgress")),
      completion: row("tool.completed", {
        ...result("completed"),
        data: { ...result("completed").data, wrote: true },
      }),
      echo: true,
    },
    {
      name: "a start, not an update",
      update: row("tool.started", result("inProgress")),
      echo: false,
    },
  ])("$name", ({ update, completion, echo }) => {
    expect(isToolCallEcho(update, completion ?? row("tool.completed", result("completed")))).toBe(
      echo,
    );
  });
});

const capturedResult = (status: string, id: string, digest?: string) => ({
  ...result(status),
  data: {
    ...result(status).data,
    zerops: {
      images: [
        {
          mimeType: "image/png",
          asset: {
            id,
            ownerId: id,
            threadId: "thread-1",
            name: "tool-image",
            provenance: "capture",
            original:
              digest === undefined
                ? { status: "failed", code: "persistence-failed" }
                : {
                    status: "ready",
                    digest,
                    mimeType: "image/png",
                    sizeBytes: 200,
                    width: 20,
                    height: 10,
                  },
          },
        },
      ],
    },
  },
});

it.each([
  {
    name: "the same retained image in two occurrences",
    left: "a".repeat(64),
    right: "a".repeat(64),
    echo: true,
  },
  {
    name: "different retained image bytes",
    left: "a".repeat(64),
    right: "b".repeat(64),
    echo: false,
  },
  { name: "malformed digests do not prove identical pictures", left: "", right: "", echo: false },
  {
    name: "two failed captures do not prove identical pictures",
    left: undefined,
    right: undefined,
    echo: false,
  },
])("$name", ({ left, right, echo }) => {
  expect(
    isToolCallEcho(
      row("tool.updated", capturedResult("inProgress", "update-picture", left)),
      row("tool.completed", capturedResult("completed", "completion-picture", right)),
    ),
  ).toBe(echo);
});
