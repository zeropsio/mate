import { describe, expect, it } from "vite-plus/test";

import type { DockBackgroundTask, DockHelper } from "./conversationDock.logic";
import { backgroundBand, helpersBand } from "./workingBands.logic";

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
