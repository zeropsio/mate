import { describe, expect, it } from "vite-plus/test";

import type { DockBackgroundTask, DockHelper } from "./conversationDock.logic";
import { afterWorkLines, backgroundBand, helpersBand } from "./workingBands.logic";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 27, 10, minute)).toISOString();

const helper = (
  id: string,
  tone: DockHelper["tone"],
  started: number,
  ended: number | null = null,
): DockHelper => ({
  id,
  title: `Review ${id}`,
  tone,
  word: tone,
  startedAt: at(started),
  endedAt: ended === null ? null : at(ended),
});

const task = (
  id: string,
  state: DockBackgroundTask["state"],
  started: number,
  ended: number | null = null,
): DockBackgroundTask => ({
  id,
  title: `Task ${id}`,
  state,
  watch: false,
  turnId: "t1",
  startedAt: at(started),
  endedAt: ended === null ? null : at(ended),
});

const group = <T>(rows: ReadonlyArray<T>) => ({ rows, working: 0, done: 0, failed: 0 });

// One place per fact (pass 43, R12-9): the mark says how it stands, the
// title what it does, the time how long; a count only where there are several.
describe("helpersBand — the helpers as one line", () => {
  it.each([
    {
      name: "one at work: its mark, its title, its time, no count",
      rows: [helper("api", "busy", 1)],
      band: { tone: "busy", count: null, title: "Review api", startedAt: at(1), endedAt: null },
      label: "Helper: Review api, working",
    },
    {
      name: "one done",
      rows: [helper("api", "ok", 1, 3)],
      band: { tone: "ok", count: null, title: "Review api", startedAt: at(1), endedAt: at(3) },
      label: "Helper: Review api, done",
    },
    {
      name: "several: the count, and the newest at work",
      rows: [helper("api", "ok", 1, 3), helper("ui", "busy", 1), helper("docs", "busy", 2)],
      band: {
        tone: "busy",
        count: "3 helpers",
        title: "Review docs",
        startedAt: at(1),
        endedAt: null,
      },
      label: "Helpers: 3, Review docs, working",
    },
    {
      name: "one that waits for the person stands over those at work",
      rows: [helper("api", "busy", 1), helper("ui", "attention", 2)],
      band: {
        tone: "attention",
        count: "2 helpers",
        title: "Review ui",
        startedAt: at(1),
        endedAt: null,
      },
      label: "Helpers: 2, Review ui, waiting for you",
    },
    {
      name: "all ended, one failed: the failure, over the time they ran",
      rows: [helper("api", "ok", 1, 3), helper("ui", "failed", 2, 5)],
      band: {
        tone: "failed",
        count: "2 helpers",
        title: "Review ui",
        startedAt: at(1),
        endedAt: at(5),
      },
      label: "Helpers: 2, Review ui, failed",
    },
  ] as const)("$name", ({ rows, band, label }) => {
    const line = helpersBand(group(rows));
    expect(line).toMatchObject({ ...band, others: null });
    expect(line.label).toBe(label);
  });
});

describe("backgroundBand — the background tasks as one line", () => {
  it.each([
    {
      name: "one running: its title and its time, nothing else",
      tasks: [task("serve", "running", 2)],
      band: { tone: "busy", title: "Task serve", others: null, startedAt: at(2), endedAt: null },
      label: "Background: Task serve, running",
    },
    {
      name: "the running one, the other in words",
      tasks: [task("seed", "done", 1, 2), task("build", "running", 2)],
      band: { tone: "busy", title: "Task build", others: "1 other done", startedAt: at(2) },
      label: "Background: Task build, running, 1 other done",
    },
    {
      name: "others in several states",
      tasks: [
        task("a", "done", 1, 2),
        task("b", "done", 1, 3),
        task("c", "failed", 1, 4),
        task("d", "running", 5),
        task("e", "running", 6),
      ],
      band: { tone: "busy", title: "Task e", others: "1 other running, 2 done, 1 failed" },
      label: "Background: Task e, running, 1 other running, 2 done, 1 failed",
    },
    {
      name: "none running: the newest to end",
      tasks: [task("a", "done", 1, 2), task("b", "failed", 1, 4)],
      band: { tone: "failed", title: "Task b", others: "1 other done", endedAt: at(4) },
      label: "Background: Task b, failed, 1 other done",
    },
    {
      name: "a task that never reported reads as stopped",
      tasks: [task("a", "lost", 1, 2), task("b", "running", 3)],
      band: { tone: "busy", title: "Task b", others: "1 other stopped" },
      label: "Background: Task b, running, 1 other stopped",
    },
  ] as const)("$name", ({ tasks, band, label }) => {
    const line = backgroundBand({ tasks, running: 0, done: 0, failed: 0 });
    expect(line).toMatchObject({ count: null, ...band });
    expect(line.label).toBe(label);
  });
});

// Eli, 2026-10-14: "Still working in the background" stood over nothing while four of its own
// background checks ran — "what is still working on bg?".
describe("what the Mate's card says still runs after its turn", () => {
  const job = (title: string | null, since = 1) => ({ title, of: "mate", since }) as const;
  const helper = (title: string | null, since = 1) => ({ title, of: "helper", since }) as const;
  const lines = (work: Parameters<typeof afterWorkLines>[0]) =>
    afterWorkLines(work).map(({ title, word }) =>
      word === undefined ? title : `${title} — ${word}`,
    );
  it.each([
    {
      name: "a line for each of a few, each saying whose it is",
      work: { items: [job("Final batched browser check"), helper("Review the diff")], count: 2 },
      said: ["Final batched browser check — Its own job", "Review the diff — Its helper"],
    },
    {
      // Eli, 2026-10-14: five helpers read as one line, "… · and 4 more — Its helpers — 2h 10m".
      name: "a row for each of five, each saying whose it is",
      work: {
        items: [
          helper("Deeper production chains + drones"),
          helper("Swarm scale toward 500k"),
          helper("Arsenal: mines, arc gates, orbital"),
          job("Run the test suite"),
          helper("Fog of war, scanning, tech tree"),
        ],
        count: 5,
        helpers: 4,
      },
      said: [
        "Deeper production chains + drones — Its helper",
        "Swarm scale toward 500k — Its helper",
        "Arsenal: mines, arc gates, orbital — Its helper",
        "Run the test suite — Its own job",
        "Fog of war, scanning, tech tree — Its helper",
      ],
    },
    {
      name: "the first five on rows of their own and how many more run",
      work: {
        items: [
          helper("One"),
          helper("Two"),
          helper("Three"),
          job("Four"),
          job("Five"),
          job("Six"),
        ],
        count: 8,
        helpers: 3,
      },
      said: [
        "One — Its helper",
        "Two — Its helper",
        "Three — Its helper",
        "Four — Its own job",
        "Five — Its own job",
        "and 3 more",
      ],
    },
    {
      name: "untitled work by what it is",
      work: { items: [job(null), helper(null)], count: 2 },
      said: ["A background job — Its own job", "A helper — Its helper"],
    },
    {
      name: "that it finishes what it started when nothing it names still runs",
      work: { items: [], count: 0 },
      said: ["Finishing work it started"],
    },
    {
      name: "that it finishes what it started when nothing names its work",
      work: undefined,
      said: ["Finishing work it started"],
    },
  ])("says $name", ({ work, said }) => {
    expect(lines(work)).toEqual(said);
  });
});

it("gives each row still running its own start, never one shared across them", () => {
  const work = {
    items: [
      {
        title: "Deeper production chains + drones",
        of: "helper",
        since: Date.UTC(2026, 9, 14, 19, 0),
      },
      { title: "Swarm scale toward 500k", of: "helper", since: Date.UTC(2026, 9, 14, 21, 2) },
    ],
    count: 2,
  } as const;
  expect(afterWorkLines(work).map((line) => line.startedAt)).toEqual([
    "2026-10-14T19:00:00.000Z",
    "2026-10-14T21:02:00.000Z",
  ]);
});
