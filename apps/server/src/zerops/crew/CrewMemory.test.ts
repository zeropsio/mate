import { describe, expect, it } from "@effect/vitest";

import {
  applyMemoryOp,
  type CrewMemoryChange,
  type CrewMemoryEntry,
  crewPacketInput,
  groundFromFields,
  recordLessons,
} from "./CrewMemory.ts";
import type { CrewMemoryOp } from "./crewSeams.ts";

const NOW = "2026-09-27T20:00:00.000Z";
const CTX = { assignment: "a-12", now: NOW, head: "abc123" } as const;

const entry = (
  overrides: Partial<CrewMemoryEntry> & Pick<CrewMemoryEntry, "id">,
): CrewMemoryEntry => ({
  kind: "decision",
  topic: "api",
  text: "Scores are integers.",
  paths: [],
  verifiedAt: null,
  fromAssignment: "a-3",
  updatedAt: "2026-09-20T10:00:00.000Z",
  ...overrides,
});

describe("applyMemoryOp", () => {
  it("adds an index entry under the next id, from the open task", () => {
    expect(
      applyMemoryOp(
        [entry({ id: "m1" }), entry({ id: "m4" })],
        { op: "add", kind: "decision", topic: "api", text: "Scores come back sorted." },
        CTX,
      ),
    ).toEqual({
      change: {
        kind: "put",
        entry: {
          id: "m5",
          kind: "decision",
          topic: "api",
          text: "Scores come back sorted.",
          paths: [],
          verifiedAt: null,
          fromAssignment: "a-12",
          updatedAt: NOW,
        },
      },
      answer: { text: "Added m5.", isError: false },
    });
  });

  const decisions = (count: number, text = "d"): ReadonlyArray<CrewMemoryEntry> =>
    Array.from({ length: count }, (_, index) => entry({ id: `m${index + 1}`, text }));
  const refused = (text: string) => ({ change: { kind: "none" }, answer: { text, isError: true } });
  const put = (text: string, fields: Partial<CrewMemoryEntry> & Pick<CrewMemoryEntry, "id">) => ({
    change: { kind: "put", entry: entry({ updatedAt: NOW, fromAssignment: "a-12", ...fields }) },
    answer: { text, isError: false },
  });
  const note = entry({ id: "m3", kind: "note", topic: "api", text: "The API notes." });
  const handoff = entry({
    id: "m5",
    kind: "handoff",
    topic: null,
    text: "Half done.",
    fromAssignment: "a-12",
  });

  // [name, entries, op, context, outcome]
  const CASES: ReadonlyArray<
    readonly [
      string,
      ReadonlyArray<CrewMemoryEntry>,
      CrewMemoryOp,
      { readonly assignment?: string; readonly now: string; readonly head?: string },
      { readonly change: CrewMemoryChange | { readonly kind: string }; readonly answer: unknown },
    ]
  > = [
    [
      "a fact keeps its paths and the tree's head",
      [],
      { op: "add", kind: "fact", topic: "db", text: "Scores live in Redis.", paths: ["src/db.ts"] },
      CTX,
      put("Added m1.", {
        id: "m1",
        kind: "fact",
        topic: "db",
        text: "Scores live in Redis.",
        paths: ["src/db.ts"],
        verifiedAt: "abc123",
      }),
    ],
    [
      "an index entry over 200 characters",
      [],
      { op: "add", kind: "lesson", topic: "x", text: "x".repeat(201) },
      CTX,
      refused("A lesson holds at most 200 characters; this one has 201."),
    ],
    [
      "a full index by count",
      decisions(30),
      { op: "add", kind: "open", topic: "x", text: "Is the board sorted?" },
      CTX,
      refused(
        "Your index is full (30 entries or 2,500 characters): merge or remove an entry first.",
      ),
    ],
    [
      "a full index by characters",
      decisions(13, "x".repeat(190)),
      { op: "add", kind: "decision", topic: "x", text: "y".repeat(31) },
      CTX,
      refused(
        "Your index is full (30 entries or 2,500 characters): merge or remove an entry first.",
      ),
    ],
    [
      "notes do not count against the index",
      [...decisions(30), { ...note, id: "m31" }],
      { op: "add", kind: "note", topic: "deploy", text: "z".repeat(4_000) },
      CTX,
      put("Added m32.", { id: "m32", kind: "note", topic: "deploy", text: "z".repeat(4_000) }),
    ],
    [
      "a second note on a topic",
      [note],
      { op: "add", kind: "note", topic: "api", text: "More." },
      CTX,
      refused('A note on "api" exists as m3: update it instead.'),
    ],
    [
      "an eleventh note",
      Array.from({ length: 10 }, (_, index) =>
        entry({ id: `m${index + 1}`, kind: "note", topic: `t${index}` }),
      ),
      { op: "add", kind: "note", topic: "new", text: "More." },
      CTX,
      refused("You have 10 notes: merge or remove one first."),
    ],
    [
      "a note over 4,000 characters",
      [],
      { op: "add", kind: "note", topic: "api", text: "x".repeat(4_001) },
      CTX,
      refused("A note holds at most 4,000 characters; this one has 4,001."),
    ],
    [
      "a handoff without an open task",
      [],
      { op: "add", kind: "handoff", topic: "t", text: "Half done." },
      { now: NOW },
      refused("A handoff belongs to a task, and no task is open."),
    ],
    [
      "a handoff replaces the task's handoff under its id",
      [handoff, entry({ id: "m6", kind: "handoff", topic: null, fromAssignment: "a-9" })],
      { op: "add", kind: "handoff", topic: "t", text: "Routes done; tests next." },
      CTX,
      put("Replaced your handoff m5.", {
        id: "m5",
        kind: "handoff",
        topic: "t",
        text: "Routes done; tests next.",
      }),
    ],
    [
      "a handoff over 2,000 characters",
      [],
      { op: "add", kind: "handoff", topic: "t", text: "x".repeat(2_001) },
      CTX,
      refused("A handoff holds at most 2,000 characters; this one has 2,001."),
    ],
    [
      "update keeps the kind and re-verifies a fact",
      [entry({ id: "m2", kind: "fact", paths: ["src/db.ts"], verifiedAt: "old" })],
      { op: "update", id: "m2", text: "Scores live in Postgres." },
      CTX,
      {
        change: {
          kind: "put",
          entry: entry({
            id: "m2",
            kind: "fact",
            paths: ["src/db.ts"],
            verifiedAt: "abc123",
            text: "Scores live in Postgres.",
            updatedAt: NOW,
          }),
        },
        answer: { text: "Updated m2.", isError: false },
      },
    ],
    [
      "update applies the entry's own cap",
      [entry({ id: "m2" })],
      { op: "update", id: "m2", text: "x".repeat(201) },
      CTX,
      refused("A decision holds at most 200 characters; this one has 201."),
    ],
    [
      "update that would overfill the index",
      decisions(13, "x".repeat(192)),
      { op: "update", id: "m1", text: "y".repeat(200) },
      CTX,
      refused(
        "Your index is full (30 entries or 2,500 characters): merge or remove an entry first.",
      ),
    ],
    [
      "update of an unknown id",
      [],
      { op: "update", id: "m9", text: "x" },
      CTX,
      refused("No entry m9: crew_memory list shows your entries."),
    ],
    [
      "remove",
      [entry({ id: "m2", kind: "unfiled" })],
      { op: "remove", id: "m2" },
      CTX,
      { change: { kind: "delete", id: "m2" }, answer: { text: "Removed m2.", isError: false } },
    ],
    [
      "remove of an unknown id",
      [],
      { op: "remove", id: "m2" },
      CTX,
      refused("No entry m2: crew_memory list shows your entries."),
    ],
  ];

  it.each(CASES)("%s", (_name, entries, op, ctx, outcome) => {
    expect(applyMemoryOp(entries, op, ctx)).toEqual(outcome);
  });
});

describe("crew_memory list", () => {
  const entries: ReadonlyArray<CrewMemoryEntry> = [
    entry({ id: "m1" }),
    entry({
      id: "m2",
      kind: "fact",
      topic: "db",
      text: "Scores live in Redis.",
      paths: ["src/db.ts"],
    }),
    entry({ id: "m3", kind: "note", topic: "api", text: "The API notes, at length." }),
    entry({ id: "m5", kind: "handoff", topic: null, text: "Routes done; tests next." }),
    entry({ id: "m7", kind: "unfiled", topic: null, text: "Vite needs --host." }),
  ];
  const list = (op: CrewMemoryOp, from: ReadonlyArray<CrewMemoryEntry> = entries) =>
    applyMemoryOp(from, op, CTX);

  it.each([
    [
      "everything, with notes by topic only",
      { op: "list" },
      entries,
      [
        "Index:",
        "- m1 [decision · api] Scores are integers.",
        "- m2 [fact · db · src/db.ts] Scores live in Redis.",
        "Notes, read one with list and its topic: api (m3)",
        "Handoff m5: Routes done; tests next.",
        "Unfiled lessons, to file with add and then remove:",
        "- m7 Vite needs --host.",
      ].join("\n"),
    ],
    [
      "one topic, notes in full",
      { op: "list", topic: "api" },
      entries,
      [
        "On api:",
        "- m1 [decision] Scores are integers.",
        "- m3 [note] The API notes, at length.",
      ].join("\n"),
    ],
    ["an empty memory", { op: "list" }, [], "Your memory is empty."],
    ["a topic with nothing", { op: "list", topic: "css" }, entries, 'Nothing on "css".'],
  ] as const)("%s", (_name, op, from, text) => {
    expect(list(op, from)).toEqual({ change: { kind: "none" }, answer: { text, isError: false } });
  });
});

describe("recordLessons", () => {
  const unfiled = (id: string, text = `lesson ${id}`) =>
    entry({ id, kind: "unfiled", topic: null, text, fromAssignment: "a-3" });

  it("queues a report's lessons as unfiled entries and drops the oldest past five", () => {
    expect(
      recordLessons(
        [unfiled("m2"), unfiled("m10"), unfiled("m4"), unfiled("m6"), entry({ id: "m11" })],
        ["Vite needs --host.", " ", "x".repeat(250)],
        CTX,
      ),
    ).toEqual([
      {
        kind: "put",
        entry: entry({
          id: "m12",
          kind: "unfiled",
          topic: null,
          text: "Vite needs --host.",
          fromAssignment: "a-12",
          updatedAt: NOW,
        }),
      },
      {
        kind: "put",
        entry: entry({
          id: "m13",
          kind: "unfiled",
          topic: null,
          text: `${"x".repeat(199)}…`,
          fromAssignment: "a-12",
          updatedAt: NOW,
        }),
      },
      { kind: "delete", id: "m2" },
    ]);
  });
});

describe("crewPacketInput", () => {
  it("takes the index with its stale marks, this task's handoff and the unfiled queue", () => {
    const task = {
      number: 12,
      title: "Scores API",
      brief: "Serve /scores.",
      doneWhen: "",
      state: "working",
      attempt: 1,
      dispatchCommit: "d1",
    } as const;
    const ground = { tip: "abc123", status: [], diffstat: [], resets: [] };
    expect(
      crewPacketInput({
        seq: 7,
        task,
        assignment: "a-12",
        ground,
        entries: [
          entry({ id: "m9", kind: "unfiled", topic: null, text: "Newer lesson." }),
          entry({ id: "m1" }),
          entry({ id: "m2", kind: "fact", text: "Scores live in Redis.", paths: ["src/db.ts"] }),
          entry({ id: "m3", kind: "note", text: "Notes stay out." }),
          entry({ id: "m4", kind: "handoff", text: "Old task's handoff.", fromAssignment: "a-9" }),
          entry({ id: "m5", kind: "handoff", text: "Routes done.", fromAssignment: "a-12" }),
          entry({ id: "m8", kind: "unfiled", topic: null, text: "Older lesson." }),
        ],
        stale: new Set(["m2"]),
      }),
    ).toEqual({
      seq: 7,
      task,
      ground,
      handoff: "Routes done.",
      index: [
        { id: "m1", kind: "decision", text: "Scores are integers.", stale: false },
        { id: "m2", kind: "fact", text: "Scores live in Redis.", stale: true },
      ],
      unfiled: [
        { id: "m8", text: "Older lesson." },
        { id: "m9", text: "Newer lesson." },
      ],
    });
  });
});

describe("groundFromFields", () => {
  const known = {
    lane: true,
    lastCheck: "passed at abc122",
    resets: ["Reset to the tree at 14:02."],
  };

  it.each([
    [
      "a copy read over ssh",
      [
        ["tip", "abc123"],
        ["status", " M src/api.ts"],
        ["status", "?? src/new.ts"],
        ["diffstat", " src/api.ts | 4 ++--"],
        ["diffstat", " 1 file changed, 2 insertions(+), 2 deletions(-)"],
        ["stale", "m2"],
      ],
      known,
      {
        ground: {
          tip: "abc123",
          status: [" M src/api.ts", "?? src/new.ts"],
          diffstat: [" src/api.ts | 4 ++--", " 1 file changed, 2 insertions(+), 2 deletions(-)"],
          lastCheck: "passed at abc122",
          resets: ["Reset to the tree at 14:02."],
        },
        stale: ["m2"],
      },
    ],
    [
      "a copy the script could not read",
      [["unavailable", "your copy .crew/backend is missing on appdev"]],
      known,
      { ground: { unavailable: "your copy .crew/backend is missing on appdev" }, stale: [] },
    ],
    [
      "a crewmate without a copy",
      [["stale", "m4"]],
      { lane: false, resets: [] },
      { ground: { unavailable: "a read-only crewmate has no copy of the code" }, stale: ["m4"] },
    ],
  ] as const)("%s", (_name, fields, facts, expected) => {
    const { ground, stale } = groundFromFields(fields, facts);
    expect({ ground, stale: [...stale] }).toEqual(expected);
  });
});
