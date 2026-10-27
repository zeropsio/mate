import type { FlowReleaseRow } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import { pull } from "./flowTestFixtures";
import { cardChanges } from "./projectCard.logic";
import {
  changeTitle,
  historyReleases,
  releaseLine,
  shownReleases,
  type HistoryRelease,
} from "./projectHistory.logic";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 19, 9, minute)).toISOString();

function release(
  tag: string,
  minute: number,
  over: Partial<FlowReleaseRow> = {},
): Pick<FlowReleaseRow, "tag" | "taggedAt" | "verdict" | "rollbackOf" | "standing" | "history"> {
  return {
    tag,
    taggedAt: at(minute),
    verdict: "approved",
    standing: undefined,
    history: recorded([]),
    ...over,
  };
}

function recorded(numbers: readonly number[]) {
  return {
    changes: numbers.map((number) => ({ repo: "app", number, title: `Change ${String(number)}` })),
    commitCount: numbers.length,
    outsideCommitCount: 0,
    ranges: [],
  };
}

const landed = (number: number, minute: number, title = `Change ${String(number)}`) =>
  pull({ number, title, merged: true, mergedAt: at(minute) });

/** Newest first, as the flow lists them: v0.1.1 runs production. */
const RELEASES = [
  release("v0.1.1", 30, { standing: "live", history: recorded([3, 2]) }),
  release("v0.1.0", 10, { history: recorded([1]) }),
];

const titles = (row: HistoryRelease | undefined) => row?.changes.map((change) => change.title);

describe("a project page's Changes and History", () => {
  it("a project page lists each fact once: unreleased changes in Changes, released ones in their release in History", () => {
    const merged = [landed(1, 5), landed(2, 20), landed(3, 25), landed(4, 40)];
    const open = [pull({ number: 5, title: "Change 5", updatedAt: at(45) })];
    const changes = cardChanges({
      open,
      merged,
      releases: RELEASES,
      stage: undefined,
      production: true,
      limit: 5,
      unreleased: true,
    }).map((change) => change.pull.title);
    const history = historyReleases({ releases: RELEASES, merged });
    const released = history.flatMap((row) => row.changes.map((change) => change.title));

    expect(changes).toEqual(["Change 5", "Change 4"]);
    expect(history.map((row) => [row.tag, titles(row)])).toEqual([
      ["v0.1.1", ["Change 3", "Change 2"]],
      ["v0.1.0", ["Change 1"]],
    ]);
    expect(changes.filter((title) => released.includes(title))).toEqual([]);
    expect([...changes, ...released].toSorted()).toEqual(
      [...open, ...merged].map((change) => change.title).toSorted(),
    );
  });

  it.each([
    [
      "Add a Surprise me chip to the tea sommelier (#9) (#11)",
      "Add a Surprise me chip to the tea sommelier",
    ],
    ["Centre the shop (#17)", "Centre the shop"],
    ['Back to top link, reading "↑ Top" (#8)', 'Back to top link, reading "↑ Top"'],
    ["Fix #12 in the footer", "Fix #12 in the footer"],
    ["(#4)", "(#4)"],
  ])("a change's title loses GitHub's trailing (#n): %s", (subject, title) => {
    expect(changeTitle(subject)).toBe(title);
  });

  it.each([
    {
      case: "the release production runs reads Live, the one it rolled back from Rolled back",
      releases: [
        release("v0.1.3", 50, { standing: "live", rollbackOf: "v0.1.1" }),
        release("v0.1.2", 40, { history: recorded([2]) }),
        release("v0.1.1", 30, { history: recorded([1]) }),
        release("v0.1.0", 10),
      ],
      rows: [
        ["v0.1.3", "live", "Back to v0.1.1"],
        ["v0.1.2", "rolled-back", "1 change"],
        ["v0.1.1", undefined, "1 change"],
        ["v0.1.0", undefined, "No changes"],
      ],
    },
    {
      case: "a refused release is no release of History's, and its changes wait for the next",
      releases: [
        release("v0.1.2", 45, { standing: "live", history: recorded([2, 1]) }),
        release("v0.1.1", 30, { verdict: "refused" }),
        release("v0.1.0", 10, { standing: "deploy-failed" }),
      ],
      rows: [
        ["v0.1.2", "live", "2 changes"],
        ["v0.1.0", "deploy-failed", "No changes"],
      ],
    },
  ])("$case", ({ releases, rows }) => {
    const history = historyReleases({
      releases,
      merged: [landed(1, 25), landed(2, 35)],
    });
    expect(history.map((row) => [row.tag, row.state, releaseLine(row)])).toEqual(rows);
  });

  it.each([
    [3, false, 3, undefined],
    [7, false, 5, 7],
    [7, true, 7, 7],
  ] as const)(
    "History shows the latest five releases and Show all past them: %i releases, all %s",
    (count, all, shown, more) => {
      const releases = Array.from({ length: count }, (_, index) =>
        release(`v0.1.${String(count - index)}`, 50 - index),
      );
      const rows = historyReleases({ releases, merged: [] });
      const drawn = shownReleases(rows, all);
      expect([drawn.rows.length, drawn.all]).toEqual([shown, more]);
    },
  );
});
