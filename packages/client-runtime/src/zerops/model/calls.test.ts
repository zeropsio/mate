import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import {
  ZEROPS_SHOWCASE_THREADS,
  type ZeropsShowcaseThread,
} from "../operations/__fixtures__/index.ts";
import { collectZeropsCalls } from "./calls.ts";

function toolCallIdsOf(thread: ZeropsShowcaseThread): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const activity of thread.activities) {
    const payload = activity.payload as Record<string, unknown> | undefined;
    const id = payload?.toolCallId;
    const data = payload?.data as Record<string, unknown> | undefined;
    const name =
      (data?.zerops as Record<string, unknown> | undefined)?.toolName ??
      (typeof data?.toolName === "string" ? data.toolName.replace(/^mcp__[^_]+__/, "") : undefined);
    if (typeof id === "string" && typeof name === "string" && name.startsWith("zerops_")) {
      ids.add(id);
    }
  }
  return ids;
}

describe.each(ZEROPS_SHOWCASE_THREADS.map((thread) => [thread.name, thread] as const))(
  "collectZeropsCalls — %s",
  (_name, thread) => {
    const calls = collectZeropsCalls(thread.activities, null);
    const expectedIds = toolCallIdsOf(thread);

    it("produces exactly one call per zerops_* toolCallId", () => {
      expect(new Set(calls.map((c) => c.id))).toEqual(expectedIds);
      expect(calls.length).toBe(expectedIds.size);
    });

    it("anchors every call at its tool.started row's createdAt", () => {
      for (const call of calls) {
        const started = thread.activities.find(
          (a) =>
            a.kind === "tool.started" &&
            (a.payload as Record<string, unknown>).toolCallId === call.id,
        );
        if (started !== undefined) {
          expect(call.startedAt).toBe(started.createdAt);
          expect(call.anchorActivityId).toBe(started.id);
        }
      }
    });

    it("every settled call carries a resultText, from data.zerops or a decodable raw result", () => {
      for (const call of calls) {
        if (call.status === "completed" || call.status === "failed") {
          const rows = thread.activities.filter(
            (a) => (a.payload as Record<string, unknown>).toolCallId === call.id,
          );
          const anyZeropsResultText = rows.some((a) => {
            const data = (a.payload as Record<string, unknown>).data as
              | Record<string, unknown>
              | undefined;
            const zerops = data?.zerops as Record<string, unknown> | undefined;
            return typeof zerops?.resultText === "string" && zerops.resultText.length > 0;
          });
          const anyDecodableRaw = rows.some((a) => {
            const data = (a.payload as Record<string, unknown>).data as
              | Record<string, unknown>
              | undefined;
            const result = data?.result as Record<string, unknown> | undefined;
            const content = result?.content;
            const text =
              typeof content === "string"
                ? content
                : Array.isArray(content)
                  ? (
                      content.find((b) => (b as Record<string, unknown>)?.type === "text") as
                        | { text?: string }
                        | undefined
                    )?.text
                  : undefined;
            if (text === undefined) {
              return false;
            }
            try {
              const parsed: unknown = JSON.parse(text);
              return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
            } catch {
              return false;
            }
          });
          if (anyZeropsResultText || anyDecodableRaw) {
            expect(call.resultText).toBeDefined();
          }
        }
      }
    });

    it("rowIds cover every activity row that shares the call's toolCallId", () => {
      for (const call of calls) {
        const rows = thread.activities.filter(
          (a) => (a.payload as Record<string, unknown>).toolCallId === call.id,
        );
        expect([...call.rowIds].sort()).toEqual(rows.map((r) => r.id).sort());
      }
    });
  },
);

// ---- synthetic cases: the lattice properties, not real transcripts ----

const started = (overrides: Partial<OrchestrationThreadActivity> & { id: string }) =>
  ({
    tone: "tool",
    kind: "tool.started",
    summary: "Tool call started",
    turnId: "t1",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
    payload: {
      toolCallId: "call-1",
      status: "inProgress",
      data: { toolName: "mcp__zerops__zerops_deploy", input: {} },
      ...(overrides.payload as Record<string, unknown> | undefined),
    },
  }) as unknown as OrchestrationThreadActivity;

const updated = (overrides: Partial<OrchestrationThreadActivity> & { id: string }) =>
  ({
    tone: "tool",
    kind: "tool.updated",
    summary: "Tool call",
    turnId: "t1",
    createdAt: "2026-09-01T00:00:01.000Z",
    ...overrides,
    payload: {
      toolCallId: "call-1",
      status: "inProgress",
      data: {},
      ...(overrides.payload as Record<string, unknown> | undefined),
    },
  }) as unknown as OrchestrationThreadActivity;

const completed = (overrides: Partial<OrchestrationThreadActivity> & { id: string }) =>
  ({
    tone: "tool",
    kind: "tool.completed",
    summary: "Tool call",
    turnId: "t1",
    createdAt: "2026-09-01T00:00:02.000Z",
    ...overrides,
    payload: {
      toolCallId: "call-1",
      status: "completed",
      data: {
        toolName: "mcp__zerops__zerops_deploy",
        result: {
          content: [{ type: "text", text: JSON.stringify({ status: "DEPLOYED" }) }],
        },
      },
      ...(overrides.payload as Record<string, unknown> | undefined),
    },
  }) as unknown as OrchestrationThreadActivity;

describe("collectZeropsCalls — the lattice properties", () => {
  it("a late tool.updated after tool.completed does not change status", () => {
    const activities = [
      started({ id: "a1", createdAt: "2026-09-01T00:00:00.000Z" }),
      completed({ id: "a3", createdAt: "2026-09-01T00:00:02.000Z" }),
      updated({ id: "a2", createdAt: "2026-09-01T00:00:05.000Z" }), // sorts after completed by createdAt
    ];
    const [call] = collectZeropsCalls(activities, "t1");
    expect(call!.status).toBe("completed");
    expect(call!.settledAt).toBe("2026-09-01T00:00:02.000Z");
  });

  it("a second tool.started for a known id is absorbed into one call", () => {
    const activities = [
      started({ id: "a1", createdAt: "2026-09-01T00:00:00.000Z" }),
      started({ id: "a1b", createdAt: "2026-09-01T00:00:00.500Z" }),
      completed({ id: "a3" }),
    ];
    const [call] = collectZeropsCalls(activities, "t1");
    expect(collectZeropsCalls(activities, "t1")).toHaveLength(1);
    expect(call!.anchorActivityId).toBe("a1");
    expect(call!.rowIds.size).toBe(3);
  });

  it("a turnId mismatch between rows of one call still yields one call", () => {
    const activities = [started({ id: "a1", turnId: "t1" }), completed({ id: "a3", turnId: "t2" })];
    const calls = collectZeropsCalls(activities, "t2");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.turnId).toBe("t1"); // first non-null turnId wins
  });

  it("agentInternal excludes the whole call when any row carries a non-empty agentId", () => {
    const activities = [
      started({ id: "a1", payload: { agentId: "sub-1" } } as never),
      completed({ id: "a3" }),
    ];
    const [call] = collectZeropsCalls(activities, "t1");
    expect(call!.agentInternal).toBe(true);
  });

  it("a running call whose turn is not the running turn is interrupted", () => {
    const activities = [started({ id: "a1", turnId: "t1" })];
    expect(collectZeropsCalls(activities, "t2")[0]!.status).toBe("interrupted");
    expect(collectZeropsCalls(activities, null)[0]!.status).toBe("interrupted");
    expect(collectZeropsCalls(activities, "t1")[0]!.status).toBe("inProgress");
  });

  it("a settled call is never interrupted even when its turn is no longer running", () => {
    const activities = [started({ id: "a1", turnId: "t1" }), completed({ id: "a3", turnId: "t1" })];
    expect(collectZeropsCalls(activities, "t2")[0]!.status).toBe("completed");
  });

  it("input is the richest (last non-empty) row", () => {
    const activities = [
      started({ id: "a1" }),
      updated({
        id: "a2",
        createdAt: "2026-09-01T00:00:01.000Z",
        payload: { data: { input: { targetService: "weatherdash" } } } as never,
      }),
      completed({ id: "a3" }),
    ];
    const [call] = collectZeropsCalls(activities, "t1");
    expect(call!.input).toEqual({ targetService: "weatherdash" });
  });

  it("a row without a toolCallId is its own call", () => {
    const activities = [
      {
        id: "solo",
        tone: "tool",
        kind: "tool.completed",
        summary: "Tool call",
        turnId: "t1",
        createdAt: "2026-09-01T00:00:00.000Z",
        payload: {
          status: "completed",
          data: { toolName: "zerops_discover" },
        },
      } as unknown as OrchestrationThreadActivity,
    ];
    const calls = collectZeropsCalls(activities, "t1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.id).toBe("anon:solo");
  });

  it("a non-zerops call never appears in the ledger", () => {
    const activities = [
      started({
        id: "a1",
        payload: { toolCallId: "x1", data: { toolName: "ToolSearch", input: {} } },
      } as never),
      completed({
        id: "a2",
        payload: { toolCallId: "x1", data: { toolName: "ToolSearch" } },
      } as never),
    ];
    expect(collectZeropsCalls(activities, "t1")).toHaveLength(0);
  });
});
