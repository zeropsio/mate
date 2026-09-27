import { describe, expect, it } from "@effect/vitest";

import {
  CREW_DELTA_MAX,
  CREW_PACKET_MAX,
  crewResumeDelta,
  crewStatePacket,
  type PacketInput,
  type PacketTask,
} from "./CrewPacket.ts";

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

const headings = (text: string): ReadonlyArray<string> =>
  text.split("\n").filter((line) => line.startsWith("## "));

describe("crewStatePacket", () => {
  it("leads with the seq, then task, ground truth, handoff, memory, unfiled", () => {
    const packet = crewStatePacket(base);

    expect(packet.split("\n")[0]).toBe("crew-state seq 42");
    expect(headings(packet)).toEqual([
      "## Task #12 (attempt 2, dispatched at a1b2c3d)",
      "## Your copy now",
      "## Handoff",
      "## Memory",
      "## Unfiled lessons",
    ]);
    expect(packet).toContain("Add cursor pagination to /api/items.");
    expect(packet).toContain("Done when: `npm test` passes; the list pages by 20.");
    expect(packet).toContain("tip e4f5a6b");
    expect(packet).toContain(" src/api/items.ts | 12 ++++++------");
    expect(packet).toContain("last check passed: npm test");
    expect(packet).toContain("reset to a1b2c3d at dispatch");
    expect(packet).toContain("- f1 [fact, stale?] items.ts owns the query.");
    expect(packet).toContain("- u1 The test db resets per file.");
  });

  it("names ground truth it could not read instead of leaving it out", () => {
    const packet = crewStatePacket({ ...base, ground: { unavailable: "ssh timed out after 5 s" } });
    expect(packet).toContain("Ground truth unavailable: ssh timed out after 5 s");
  });

  it("leaves out empty parts", () => {
    const packet = crewStatePacket({ ...base, handoff: undefined, index: [], unfiled: [] });
    expect(headings(packet)).toEqual([
      "## Task #12 (attempt 2, dispatched at a1b2c3d)",
      "## Your copy now",
    ]);
  });

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

  it("stays within 8,000 characters, trimming the index before the diffstat", () => {
    const packet = crewStatePacket({
      ...base,
      ground: { ...ground, diffstat: bigDiffstat.slice(0, 5) },
      index: bigIndex,
    });

    expect(packet.length).toBeLessThanOrEqual(CREW_PACKET_MAX);
    expect(packet).toContain(" src/module4/file.ts | 3 ++-");
    expect(packet).toContain("- m0 [lesson]");
    expect(packet).not.toContain("- m199 [lesson]");
    expect(packet).toMatch(/more entries: crew_memory view/u);
    expect(packet.split("\n")[0]).toBe("crew-state seq 42");
  });

  it("trims the diffstat once the index is gone", () => {
    const packet = crewStatePacket({
      ...base,
      ground: { ...ground, diffstat: bigDiffstat },
      handoff: "h".repeat(5_000),
      index: bigIndex,
    });

    expect(packet.length).toBeLessThanOrEqual(CREW_PACKET_MAX);
    expect(packet).not.toContain("- m0 [lesson]");
    expect(packet).toContain(" src/module0/file.ts | 3 ++-");
    expect(packet).not.toContain(" src/module399/file.ts | 3 ++-");
    expect(packet).toMatch(/more files/u);
  });

  it("cuts a part past its share: the task at 1,500, the handoff at 2,000", () => {
    const packet = crewStatePacket({
      ...base,
      task: { ...task, brief: "b".repeat(4_000) },
      handoff: "h".repeat(4_000),
    });
    expect(packet.match(/b+/u)![0].length).toBeLessThan(1_500);
    expect(packet.match(/h{100,}/u)![0].length).toBeLessThan(2_000);
  });
});

describe("crewResumeDelta", () => {
  it("says the new seq supersedes, then the task's state and the ground truth", () => {
    const delta = crewResumeDelta({ seq: 43, task, ground });

    expect(delta.split("\n")[0]).toBe("crew-state seq 43 supersedes earlier crew-state blocks.");
    expect(delta).toContain("Task #12 is working, attempt 2.");
    expect(delta).toContain("tip e4f5a6b");
    expect(delta).not.toContain("Add cursor pagination");
  });

  it("stays within 1,000 characters", () => {
    const delta = crewResumeDelta({
      seq: 44,
      task,
      ground: {
        ...ground,
        status: Array.from({ length: 200 }, (_, index) => `?? new${index}.ts`),
        diffstat: Array.from({ length: 200 }, (_, index) => ` f${index}.ts | 1 +`),
      },
    });
    expect(delta.length).toBeLessThanOrEqual(CREW_DELTA_MAX);
    expect(delta.split("\n")[0]).toBe("crew-state seq 44 supersedes earlier crew-state blocks.");
  });

  it("carries no task when the crewmate has none open", () => {
    const delta = crewResumeDelta({ seq: 45, task: undefined, ground });
    expect(delta).toContain("No task is open.");
  });
});
