import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import {
  backgroundLineOf,
  taskItems,
  type BackgroundItem,
  type BackgroundState,
} from "./backgroundLine.logic";

const item = (
  title: string,
  state: BackgroundState,
  report: string | null = null,
): BackgroundItem => ({
  key: title,
  title,
  state,
  report,
  mono: true,
});

describe("backgroundLineOf", () => {
  it.each<{
    readonly name: string;
    readonly items: ReadonlyArray<BackgroundItem>;
    readonly words: string;
    readonly where: string | null;
    readonly failed: boolean;
    readonly opens: ReadonlyArray<string>;
  }>([
    {
      name: "one running",
      items: [item("Run the soak test", "running")],
      words: "Run the soak test",
      where: "running in the background",
      failed: false,
      opens: [],
    },
    {
      // R7: opened, it said its own title again.
      name: "one finished, saying nothing more: nothing to open",
      items: [item("Run the soak test", "done")],
      words: "Run the soak test finished",
      where: "ran in the background",
      failed: false,
      opens: [],
    },
    {
      name: "one failed, saying how in a few words: on the line, nothing to open",
      items: [item("Run the failing job", "failed", "Exit code 3")],
      words: "Run the failing job failed",
      where: "ran in the background · Exit code 3",
      failed: true,
      opens: [],
    },
    {
      name: "one failed with a long report: it opens onto it, never its title again",
      items: [
        item("Run the failing job", "failed", "Error: listen EADDRINUSE\n  at Server.listen"),
      ],
      words: "Run the failing job failed",
      where: "ran in the background",
      failed: true,
      opens: ["Run the failing job"],
    },
    {
      name: "several, some running: each state counted",
      items: [
        item("Soak", "running"),
        item("Outdated", "done"),
        item("Fails", "failed", "Exit code 3"),
      ],
      words: "3 background jobs: 1 running, 1 finished, 1 failed",
      where: null,
      failed: true,
      opens: ["Fails", "Soak", "Outdated"],
    },
    {
      name: "several, all finished",
      items: [item("Soak", "done"), item("Outdated", "done")],
      words: "2 background jobs finished",
      where: null,
      failed: false,
      opens: ["Soak", "Outdated"],
    },
    {
      name: "several ended, one failed",
      items: [item("Soak", "done"), item("Fails", "failed")],
      words: "2 background jobs: 1 finished, 1 failed",
      where: null,
      failed: true,
      opens: ["Fails", "Soak"],
    },
    {
      name: "one whose session is gone",
      items: [item("Run the soak test", "lost")],
      words: "Run the soak test didn't report back",
      where: "ran in the background",
      failed: false,
      opens: [],
    },
    {
      name: "several, one never reporting",
      items: [item("Soak", "lost"), item("Outdated", "done")],
      words: "2 background jobs: 1 finished, 1 didn't report back",
      where: null,
      failed: false,
      opens: ["Soak", "Outdated"],
    },
  ])("$name", ({ items, words, where, failed, opens }) => {
    const line = backgroundLineOf(items, false);
    expect(line).toMatchObject({ words, where, failed });
    expect(line.items.map((shown) => shown.title)).toEqual(opens);
  });

  it("counts a turn's tasks only up as they finish", () => {
    const states: ReadonlyArray<ReadonlyArray<BackgroundState>> = [
      ["running", "running", "running"],
      ["running", "done", "running"],
      ["running", "done", "failed"],
      ["done", "done", "failed"],
    ];
    const ended = states.map((each) => {
      const line = backgroundLineOf(
        each.map((state, index) => item(`t${index}`, state)),
        false,
      );
      return line.words;
    });
    expect(ended).toEqual([
      "3 background jobs running",
      "3 background jobs: 2 running, 1 finished",
      "3 background jobs: 1 running, 1 finished, 1 failed",
      "3 background jobs: 2 finished, 1 failed",
    ]);
  });
});

describe("taskItems", () => {
  const entry = (id: string, extra: Partial<WorkLogEntry>): WorkLogEntry => ({
    id,
    createdAt: "2026-09-27T08:00:00.000Z",
    label: "Run the soak test",
    toolTitle: "Run the soak test",
    tone: "info",
    sourceActivityKind: "task.completed",
    taskId: "b1",
    ...extra,
  });

  it("takes each task's last word, and only what its report adds", () => {
    expect(
      taskItems([
        entry("e1", { sourceActivityKind: "task.progress" }),
        entry("e2", {
          tone: "error",
          detail: 'Background command "Run the soak test" failed with exit code 144',
        }),
      ]),
    ).toEqual([
      {
        key: "e2",
        title: "Run the soak test",
        state: "failed",
        report: "Exit code 144",
        mono: true,
      },
    ]);
  });
});
