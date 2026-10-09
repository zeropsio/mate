import { describe, expect, it } from "@effect/vitest";

import { ConversationId } from "@t3tools/contracts";

import {
  CALL_DATA_LIMIT,
  boundedCallData,
  planOf,
  planOfChain,
  recordsOf,
  type V1Segment,
  type V1Skeleton,
} from "./v1.ts";

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
      "the newest whole turns that fit the record limit, the marker counted",
      5,
      3,
      { turns: 10, records: 11 },
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

describe("where the bounds cut", () => {
  const conversation = ConversationId.make("mate");
  it("leaves one marker first in the oldest run brought over, saying how much stayed behind", () => {
    const plan = planOf(skeleton(5, 1), { turns: 2, records: 100 });
    const { records } = recordsOf(conversation, plan, 0, 3, {
      messages: new Map(),
      activities: new Map(),
    });
    expect(records.map((record) => record._tag)).toEqual([
      "RunImported",
      "ItemImported",
      "ItemImported",
    ]);
    expect(records[1]).toMatchObject({
      runId: "mate/r/1",
      itemId: "mate/r/1/i/1",
      by: { kind: "engine" },
      body: {
        kind: "marker",
        marker: {
          kind: "history-cut",
          reason: "3 earlier turns stayed with the previous engine: this conversation starts here.",
        },
      },
      happenedAt: Date.parse(iso(3)) - 1,
    });
    expect(records[2]).toMatchObject({ itemId: "mate/r/1/i/2", body: { kind: "person" } });
  });

  it("leaves no marker when every turn came over", () => {
    const plan = planOf(skeleton(2, 1), { turns: 10, records: 100 });
    expect(plan.entries.map((entry) => entry.kind)).toEqual([
      "run",
      "message",
      "message",
      "run",
      "message",
      "message",
    ]);
  });
});

/** A stint's thread: `count` turns a minute apart from `minute`, each a message and a note. */
const stint = (name: string, minute: number, count: number): V1Skeleton => ({
  turns: Array.from({ length: count }, (_, index) => ({
    key: `${name}-turn-${index}`,
    turnId: `${name}-turn-${index}`,
    pendingMessageId: `${name}-user-${index}`,
    state: "completed",
    requestedAt: iso(minute + index),
    startedAt: iso(minute + index),
    completedAt: iso(minute + index),
  })),
  messages: Array.from({ length: count }, (_, index) => [
    { id: `${name}-user-${index}`, role: "user", turnId: null, createdAt: iso(minute + index) },
    {
      id: `${name}-note-${index}`,
      role: "assistant",
      turnId: `${name}-turn-${index}`,
      createdAt: iso(minute + index).replace(":00.000Z", ":30.000Z"),
    },
  ]).flat(),
  activities: [],
});

const chain = (counts: ReadonlyArray<number>): ReadonlyArray<V1Segment> =>
  counts.map((count, index) => ({
    threadId: `stint-${index + 1}`,
    boundary:
      index === 0
        ? null
        : { stint: index + 1, reason: index === 1 ? "cleared" : "job", words: `why ${index + 1}` },
    skeleton: stint(`s${index + 1}`, index * 10, count),
  }));

describe("a crewmate's stints", () => {
  const conversation = ConversationId.make("crew-main-ana-1");
  const empty = { messages: new Map(), activities: new Map() };

  it("read as one conversation with boundaries", () => {
    const plan = planOfChain(chain([2, 1, 2]));
    expect(plan.runs.map((run) => [run.threadId, run.turn.turnId])).toEqual([
      ["stint-1", "s1-turn-0"],
      ["stint-1", "s1-turn-1"],
      ["stint-2", "s2-turn-0"],
      ["stint-3", "s3-turn-0"],
      ["stint-3", "s3-turn-1"],
    ]);
    const { records, data } = recordsOf(conversation, plan, 0, plan.entries.length, empty);
    const markers = records.flatMap((record) =>
      record._tag === "ItemImported" && record.body.kind === "marker"
        ? [[record.itemId, record.body.marker, record.happenedAt] as const]
        : [],
    );
    expect(markers).toEqual([
      [
        "crew-main-ana-1/r/3/i/1",
        { kind: "session-rotated", reason: "cleared" },
        Date.parse(iso(10)) - 1,
      ],
      [
        "crew-main-ana-1/r/4/i/1",
        { kind: "session-rotated", reason: "job" },
        Date.parse(iso(20)) - 1,
      ],
    ]);
    expect(data.find((entry) => entry.itemId === "crew-main-ana-1/r/3/i/1")?.data).toEqual({
      source: "v1",
      kind: "stint",
      stint: 2,
      threadId: "stint-2",
      words: "why 2",
    });
    // Each stint's records stay in its own runs: the boundary first, then its turn's words.
    expect(
      records.flatMap((record) => (record._tag === "ItemImported" ? [record.itemId] : [])),
    ).toEqual([
      "crew-main-ana-1/r/1/i/1",
      "crew-main-ana-1/r/1/i/2",
      "crew-main-ana-1/r/2/i/1",
      "crew-main-ana-1/r/2/i/2",
      "crew-main-ana-1/r/3/i/1",
      "crew-main-ana-1/r/3/i/2",
      "crew-main-ana-1/r/3/i/3",
      "crew-main-ana-1/r/4/i/1",
      "crew-main-ana-1/r/4/i/2",
      "crew-main-ana-1/r/4/i/3",
      "crew-main-ana-1/r/5/i/1",
      "crew-main-ana-1/r/5/i/2",
    ]);
  });

  it.each([
    [
      "keep the chain's newest turns, cutting across stints",
      { turns: 2, records: 100 },
      [
        ["stint-3", "s3-turn-0"],
        ["stint-3", "s3-turn-1"],
      ],
      ["run", "cut", "boundary", "message", "message", "run", "message", "message"],
    ],
    [
      "leave a stint begun before the cut without its boundary",
      { turns: 1, records: 100 },
      [["stint-3", "s3-turn-1"]],
      ["run", "cut", "message", "message"],
    ],
    [
      "count their boundaries toward the record limit",
      { turns: 10, records: 7 },
      [["stint-3", "s3-turn-1"]],
      ["run", "cut", "message", "message"],
    ],
  ] as const)("%s", (_name, limits, kept, kinds) => {
    const plan = planOfChain(chain([2, 1, 2]), limits);
    expect(plan.runs.map((run) => [run.threadId, run.turn.turnId])).toEqual(kept);
    expect(plan.entries.map((entry) => entry.kind)).toEqual(kinds);
  });

  it("open with no boundary for a stint that holds no turn", () => {
    const plan = planOfChain(chain([1, 0, 1]));
    expect(
      plan.entries.flatMap((entry) => (entry.kind === "boundary" ? [entry.reason] : [])),
    ).toEqual(["job"]);
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

describe("a call V1 heard return", () => {
  const conversation = ConversationId.make("mate");
  const head = (id: string, kind: string, minute: number) => ({
    id,
    kind,
    summary: "Tool call",
    turnId: "turn-0",
    callId: "call-1",
    taskId: null,
    createdAt: iso(minute),
    sequence: null,
    payload: null,
  });
  // V1 recorded an update in the same millisecond as the completion; ties sort by id, after it.
  const lifecycle = [
    head("a-started", "tool.started", 1),
    head("b-completed", "tool.completed", 2),
    head("c-updated", "tool.updated", 2),
  ];
  const payloads: Record<string, unknown> = {
    "a-started": { itemType: "command_execution", status: "inProgress", data: { command: "ls" } },
    "b-completed": { itemType: "command_execution", status: "completed", data: { command: "ls" } },
    "c-updated": { itemType: "command_execution", status: "inProgress", data: { command: "ls" } },
  };

  it("has returned, though an update V1 kept after it carries no end", () => {
    const plan = planOf({ ...skeleton(1, 0), activities: lifecycle }, { turns: 10, records: 100 });
    const { records } = recordsOf(conversation, plan, 0, plan.entries.length, {
      messages: new Map([["user-0", { text: "go", attachments: [] }]]),
      activities: new Map(
        lifecycle.map((activity) => [
          activity.id,
          { kind: activity.kind, summary: activity.summary, payload: payloads[activity.id] },
        ]),
      ),
    });
    const call = records.find(
      (record) => record._tag === "ItemImported" && record.body.kind === "call",
    );
    expect(call).toMatchObject({
      body: { kind: "call", step: "command", state: "done", endedAt: Date.parse(iso(2)) },
    });
  });
});

describe("a call V1 began before the turn it is filed under", () => {
  // Claude woke the Mate with a call already started: V1 kept its start and an update under no
  // turn (time puts them in the turn before) and its completion under the turn that began.
  const head = (id: string, kind: string, at: string, turnId: string | null) => ({
    id,
    kind,
    summary: "Ran command",
    turnId,
    callId: "call-early",
    taskId: null,
    createdAt: at,
    sequence: null,
    payload: null,
  });
  const lifecycle = [
    head("a-started", "tool.started", "2026-10-05T07:00:50.000Z", null),
    head("b-updated", "tool.updated", "2026-10-05T07:00:55.000Z", null),
    head("c-completed", "tool.completed", "2026-10-05T07:01:05.000Z", "turn-1"),
  ];

  it("is one call, in the turn V1 draws it in, and leaves the turn before as it ended", () => {
    const plan = planOf({ ...skeleton(2, 0), activities: lifecycle }, { turns: 10, records: 100 });
    const calls = plan.entries.filter((entry) => entry.kind === "call");
    expect(calls.map((entry) => entry.run)).toEqual([2]);
    expect(calls[0]).toMatchObject({ ids: ["a-started", "b-updated", "c-completed"] });
    expect(plan.runs[0]?.lastAt).toBe(Date.parse(iso(0)));
  });
});

describe("work V1 kept under no turn, after a turn's last word", () => {
  // The agent went on between turns: V1 kept the calls under no turn and drew them outside every
  // card, so no card counted them or ran on to them.
  const call = (id: string, at: string) => [
    {
      id: `${id}-started`,
      kind: "tool.started",
      summary: "Ran command",
      turnId: null,
      callId: id,
      taskId: null,
      createdAt: at,
      sequence: null,
      payload: null,
    },
    {
      id: `${id}-completed`,
      kind: "tool.completed",
      summary: "Ran command",
      turnId: null,
      callId: id,
      taskId: null,
      createdAt: at.replace(".000Z", ".500Z"),
      sequence: null,
      payload: null,
    },
  ];
  const inside = {
    id: "named-call-started",
    kind: "tool.started",
    summary: "Ran command",
    turnId: "turn-0",
    callId: "named-call",
    taskId: null,
    createdAt: "2026-10-05T07:00:20.000Z",
    sequence: null,
    payload: null,
  };

  it("is a run of its own between the turns, never counted on the turn before", () => {
    const activities = [
      ...call("before-last", "2026-10-05T07:00:10.000Z"),
      inside,
      ...call("loose-1", "2026-10-05T07:00:40.000Z"),
      ...call("loose-2", "2026-10-05T07:00:45.000Z"),
    ];
    // Turn 0's note at :30 is its last word; turn 1 is asked at 07:01.
    const plan = planOf({ ...skeleton(2, 1), activities }, { turns: 10, records: 100 });
    expect(plan.runs.map((run) => run.turn.turnId)).toEqual(["turn-0", null, "turn-1"]);
    const callsByRun = plan.entries.flatMap((entry) =>
      entry.kind === "call" ? [[entry.run, entry.ids[0]] as const] : [],
    );
    expect(callsByRun).toEqual([
      [1, "before-last-started"],
      [1, "named-call-started"],
      [2, "loose-1-started"],
      [2, "loose-2-started"],
    ]);
    expect(plan.runs[0]?.lastAt).toBe(Date.parse("2026-10-05T07:00:30.000Z"));
  });
});

describe("a background task V1 began in a turn and finished under no turn", () => {
  const head = (id: string, kind: string, at: string, turnId: string | null) => ({
    id,
    kind,
    summary: "Ran a task",
    turnId,
    callId: kind.startsWith("tool.") ? `${id}-call` : null,
    taskId: kind.startsWith("task.") ? "task-1" : null,
    createdAt: at,
    sequence: null,
    payload: null,
  });

  it("is one item, in the turn that started it, though loose work fell between", () => {
    const activities = [
      head("task-started", "task.started", "2026-10-05T07:00:20.000Z", "turn-0"),
      // Turn 0's note at :30 is its last word: this call is loose work, a run of its own.
      head("loose", "tool.started", "2026-10-05T07:00:35.000Z", null),
      head("task-completed", "task.completed", "2026-10-05T07:00:40.000Z", null),
    ];
    const plan = planOf({ ...skeleton(2, 1), activities }, { turns: 10, records: 100 });
    const work = plan.entries.filter((entry) => entry.kind === "work");
    expect(work).toHaveLength(1);
    expect(work[0]).toMatchObject({ run: 1, ids: ["task-started", "task-completed"] });
  });
});
