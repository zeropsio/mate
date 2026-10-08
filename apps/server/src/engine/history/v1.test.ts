import { describe, expect, it } from "@effect/vitest";

import { CALL_DATA_LIMIT, boundedCallData, planOf, type V1Skeleton } from "./v1.ts";

const iso = (minute: number) => `2026-10-05T07:${String(minute).padStart(2, "0")}:00.000Z`;

/** `count` turns a minute apart, each a person's message and `notes` notes. */
const skeleton = (count: number, notes: number): V1Skeleton => ({
  turns: Array.from({ length: count }, (_, index) => ({
    key: `turn-${index}`,
    turnId: `turn-${index}`,
    pendingMessageId: `user-${index}`,
    state: "completed",
    requestedAt: iso(index),
    startedAt: iso(index),
    completedAt: iso(index),
  })),
  messages: Array.from({ length: count }, (_, index) => [
    { id: `user-${index}`, role: "user", turnId: null, createdAt: iso(index) },
    ...Array.from({ length: notes }, (_, note) => ({
      id: `note-${index}-${note}`,
      role: "assistant",
      turnId: `turn-${index}`,
      createdAt: iso(index).replace(":00.000Z", ":30.000Z"),
    })),
  ]).flat(),
  activities: [],
});

const turnsOf = (plan: ReturnType<typeof planOf>) => plan.runs.map((run) => run.turn.turnId);

describe("the turns a conversation brings over", () => {
  it.each([
    [
      "all of them, within the bounds",
      3,
      1,
      { turns: 10, records: 100 },
      ["turn-0", "turn-1", "turn-2"],
      0,
    ],
    ["the newest, past the turn limit", 5, 1, { turns: 2, records: 100 }, ["turn-3", "turn-4"], 3],
    [
      "the newest whole turns that fit the record limit",
      5,
      3,
      { turns: 10, records: 10 },
      ["turn-3", "turn-4"],
      3,
    ],
    [
      "the newest turn whole, even past the record limit",
      2,
      30,
      { turns: 10, records: 10 },
      ["turn-1"],
      1,
    ],
  ] as const)("are %s", (_name, count, notes, limits, kept, left) => {
    const plan = planOf(skeleton(count, notes), limits);
    expect(turnsOf(plan)).toEqual(kept);
    expect(plan.leftTurns).toBe(left);
    expect(plan.entries.filter((entry) => entry.kind === "run").map((entry) => entry.run)).toEqual(
      kept.map((_turn, index) => index + 1),
    );
  });
});

describe("a call's V1 payload, kept as its data", () => {
  const big = "x".repeat(CALL_DATA_LIMIT);
  const picture = { mimeType: "image/png", asset: { id: "occurrence", name: "tool-image" } };
  it.each([
    [
      "is kept whole when it fits",
      { itemType: "command_execution", detail: "ls", data: { command: "ls" } },
      { itemType: "command_execution", detail: "ls", data: { command: "ls" } },
    ],
    [
      "keeps its pictures' references",
      { data: { zerops: { toolName: "zerops_browser", resultText: "ok", images: [picture] } } },
      { data: { zerops: { toolName: "zerops_browser", resultText: "ok", images: [picture] } } },
    ],
    [
      "drops a result text past the limit, saying so",
      { data: { zerops: { toolName: "zerops_deploy", resultText: big } } },
      { data: { zerops: { toolName: "zerops_deploy", truncated: true } } },
    ],
    [
      "drops its output past the limit, keeping its command",
      { detail: "cat log", data: { command: "cat log", rawOutput: { content: big } } },
      { detail: "cat log", data: { command: "cat log" } },
    ],
    [
      "keeps only its words when nothing else fits",
      {
        itemType: "file_change",
        title: "Write",
        detail: big,
        data: { toolName: "Write", input: big },
      },
      {
        itemType: "file_change",
        title: "Write",
        detail: big.slice(0, 2_000),
        data: { toolName: "Write" },
        truncated: true,
      },
    ],
  ] as const)("%s", (_name, payload, kept) => {
    expect(boundedCallData(payload)).toEqual(kept);
  });
});
