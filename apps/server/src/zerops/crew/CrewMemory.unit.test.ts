import { expect, it } from "vite-plus/test";

import {
  applyMemoryOp,
  crewPacketInput,
  recordLessons,
  type CrewMemoryEntry,
} from "./CrewMemory.ts";
import {
  crewResumeDelta,
  crewStatePacket,
  type PacketInput,
  type PacketTask,
} from "./CrewPacket.ts";

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

const task: PacketTask = {
  number: 12,
  title: "Add pagination",
  brief: "Add cursor pagination to /api/items.",
  doneWhen: "`npm test` passes; the list pages by 20.",
  state: "working",
  attempt: 2,
  dispatchCommit: "a1b2c3d",
};
const ground = {
  tip: "e4f5a6b",
  status: [" M src/api/items.ts"],
  diffstat: [" src/api/items.ts | 12 ++++++------"],
  lastCheck: "passed: npm test",
  resets: ["reset to a1b2c3d at dispatch"],
};

const base: PacketInput = {
  seq: 42,
  task,
  ground,
  handoff: "state: cursor type added\nnext step: wire the route",
  index: [
    { id: "d1", kind: "decision", text: "Cursors are opaque base64 strings.", stale: false },
    { id: "f1", kind: "fact", text: "items.ts owns the query.", stale: true },
  ],
  unfiled: [{ id: "u1", text: "The test db resets per file." }],
};

// witness: apps/server/src/zerops/crew/CrewPacket.ts | while (packet.length > CREW_PACKET_MAX && indexShown > 0) → while (packet.length > CREW_PACKET_MAX && indexShown > 1)
it("CM35: A crewmate's state packet stays within 8,000 characters, giving up memory index entries before diffstat lines, and its resume delta within 1,000", () => {
  const bigIndex = Array.from({ length: 200 }, (_, index) => ({
    id: `m${index}`,
    kind: "lesson",
    text: `Lesson number ${index} ${"x".repeat(150)}`,
    stale: false,
  }));
  const bigDiffstat = Array.from(
    { length: 400 },
    (_, index) => ` src/module${index}/file.ts | 3 ++-`,
  );

  const packet = crewStatePacket({
    ...base,
    ground: { ...ground, diffstat: bigDiffstat.slice(0, 5) },
    index: bigIndex,
  });
  expect(packet.length).toBeLessThanOrEqual(8_000);
  expect(packet).toContain(" src/module4/file.ts | 3 ++-");
  expect(packet).toContain(bigIndex[0]!.text);
  expect(packet).not.toContain(bigIndex[199]!.text);

  const trimmed = crewStatePacket({
    ...base,
    ground: { ...ground, diffstat: bigDiffstat },
    handoff: "h".repeat(5_000),
    index: bigIndex,
  });
  expect(trimmed.length).toBeLessThanOrEqual(8_000);
  expect(trimmed).not.toContain(bigIndex[0]!.text);
  expect(trimmed).toContain(" src/module0/file.ts | 3 ++-");
  expect(trimmed).not.toContain(" src/module399/file.ts | 3 ++-");
  const delta = crewResumeDelta({
    seq: 44,
    task,
    ground: {
      ...ground,
      status: Array.from({ length: 200 }, (_, index) => `?? new${index}.ts`),
      diffstat: Array.from({ length: 200 }, (_, index) => ` f${index}.ts | 1 +`),
    },
  });
  expect(delta.length).toBeLessThanOrEqual(1_000);
});

// witness: apps/server/src/zerops/crew/CrewPacket.ts | return `Ground truth unavailable: ${ground.unavailable}`; → return "Ground truth unavailable";
it("CM36: A crewmate's state packet names ground truth it could not read, with the reason, instead of leaving it out", () => {
  const packet = crewStatePacket({ ...base, ground: { unavailable: "ssh timed out after 5 s" } });
  expect(packet).toContain("ssh timed out after 5 s");
});

const note = entry({ id: "m3", kind: "note", topic: "api", text: "The API notes." });
const refused = { change: { kind: "none" }, answer: { isError: true } };

// witness: apps/server/src/zerops/crew/CrewMemory.ts | kept.length < INDEX_ENTRIES_MAX && chars <= INDEX_CHARS_MAX → kept.length <= INDEX_ENTRIES_MAX && chars <= INDEX_CHARS_MAX
it("CM37: A crewmate's memory index holds at most 30 entries or 2,500 characters: an add or an update past either is refused and changes nothing, and notes do not count against it", () => {
  const decisions = (count: number, text = "d"): ReadonlyArray<CrewMemoryEntry> =>
    Array.from({ length: count }, (_, index) => entry({ id: `m${index + 1}`, text }));
  expect(
    applyMemoryOp(
      decisions(30),
      { op: "add", kind: "open", topic: "x", text: "Is the board sorted?" },
      CTX,
    ),
  ).toMatchObject(refused);
  expect(
    applyMemoryOp(
      decisions(13, "x".repeat(190)),
      { op: "add", kind: "decision", topic: "x", text: "y".repeat(31) },
      CTX,
    ),
  ).toMatchObject(refused);
  expect(
    applyMemoryOp(
      [...decisions(30), { ...note, id: "m31" }],
      { op: "add", kind: "note", topic: "deploy", text: "z".repeat(4_000) },
      CTX,
    ),
  ).toMatchObject({ change: { kind: "put" }, answer: { isError: false } });
  expect(
    applyMemoryOp(
      decisions(13, "x".repeat(192)),
      { op: "update", id: "m1", text: "y".repeat(200) },
      CTX,
    ),
  ).toMatchObject(refused);
});

// witness: apps/server/src/zerops/crew/CrewMemory.ts | notes.length >= NOTES_MAX → notes.length > NOTES_MAX
it("CM38: A memory entry past its kind's length is refused and changes nothing, and a crewmate keeps at most ten notes, one per topic", () => {
  expect(
    applyMemoryOp([], { op: "add", kind: "lesson", topic: "x", text: "x".repeat(201) }, CTX),
  ).toMatchObject(refused);
  expect(
    applyMemoryOp([], { op: "add", kind: "note", topic: "api", text: "x".repeat(4_001) }, CTX),
  ).toMatchObject(refused);
  expect(
    applyMemoryOp([], { op: "add", kind: "handoff", topic: "t", text: "x".repeat(2_001) }, CTX),
  ).toMatchObject(refused);
  expect(
    applyMemoryOp([entry({ id: "m2" })], { op: "update", id: "m2", text: "x".repeat(201) }, CTX),
  ).toMatchObject(refused);
  expect(
    applyMemoryOp([note], { op: "add", kind: "note", topic: "api", text: "More." }, CTX),
  ).toMatchObject(refused);
  const notes = Array.from({ length: 10 }, (_, index) =>
    entry({ id: `m${index + 1}`, kind: "note", topic: `t${index}` }),
  );
  expect(
    applyMemoryOp(notes, { op: "add", kind: "note", topic: "new", text: "More." }, CTX),
  ).toMatchObject(refused);
});

// witness: apps/server/src/zerops/crew/CrewMemory.ts | entry: { ...entry, id: current.id }, → entry,
it("CM39: A handoff belongs to the open task: without one it is refused, and a second replaces the first under the same id", () => {
  expect(
    applyMemoryOp([], { op: "add", kind: "handoff", topic: "t", text: "Half done." }, { now: NOW }),
  ).toMatchObject(refused);
  const handoffs = [
    entry({ id: "m5", kind: "handoff", topic: null, text: "Half done.", fromAssignment: "a-12" }),
    entry({ id: "m6", kind: "handoff", topic: null, fromAssignment: "a-9" }),
  ];
  expect(
    applyMemoryOp(
      handoffs,
      { op: "add", kind: "handoff", topic: "t", text: "Routes done; tests next." },
      CTX,
    ),
  ).toMatchObject({
    change: {
      kind: "put",
      entry: {
        id: "m5",
        kind: "handoff",
        text: "Routes done; tests next.",
        fromAssignment: "a-12",
      },
    },
    answer: { isError: false },
  });
});

// witness: apps/server/src/zerops/crew/CrewMemory.ts | verifiedAt: current.kind === "fact" ? (ctx.head ?? null) : current.verifiedAt, → verifiedAt: current.verifiedAt,
it("CM40: A fact keeps its paths and the tree's head it was written at, and an update verifies it again at the current head", () => {
  expect(
    applyMemoryOp(
      [],
      { op: "add", kind: "fact", topic: "db", text: "Scores live in Redis.", paths: ["src/db.ts"] },
      CTX,
    ).change,
  ).toMatchObject({
    kind: "put",
    entry: { kind: "fact", paths: ["src/db.ts"], verifiedAt: "abc123" },
  });
  const oldFact = entry({ id: "m2", kind: "fact", paths: ["src/db.ts"], verifiedAt: "old" });
  expect(
    applyMemoryOp([oldFact], { op: "update", id: "m2", text: "Scores live in Postgres." }, CTX)
      .change,
  ).toMatchObject({
    kind: "put",
    entry: { id: "m2", kind: "fact", paths: ["src/db.ts"], verifiedAt: "abc123" },
  });
});

// witness: apps/server/src/zerops/crew/CrewMemory.ts | queue.length - UNFILED_MAX → queue.length - UNFILED_MAX + 1
it("CM41: A report's lessons queue as unfiled entries, at most five, the oldest dropped", () => {
  const unfiled = (id: string) =>
    entry({ id, kind: "unfiled", topic: null, text: `lesson ${id}`, fromAssignment: "a-3" });
  expect(
    recordLessons(
      [unfiled("m2"), unfiled("m10"), unfiled("m4"), unfiled("m6"), entry({ id: "m11" })],
      ["Vite needs --host.", " ", "x".repeat(250)],
      CTX,
    ),
  ).toMatchObject([
    { kind: "put", entry: { id: "m12", kind: "unfiled", text: "Vite needs --host." } },
    { kind: "put", entry: { id: "m13", kind: "unfiled", text: `${"x".repeat(199)}…` } },
    { kind: "delete", id: "m2" },
  ]);
});

// witness: apps/server/src/zerops/crew/CrewMemory.ts | stale: input.stale.has(entry.id), → stale: input.stale.has(entry.text),
it("CM42: A crewmate's packet carries its memory index with its stale marks, the open task's handoff and the unfiled lessons, never its notes", () => {
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
