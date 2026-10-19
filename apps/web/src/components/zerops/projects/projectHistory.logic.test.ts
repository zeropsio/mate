import type { FlowReleaseRow } from "@t3tools/client-runtime/zerops";
import type { CompareCommit } from "@t3tools/shared/hqChanges";
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
): Pick<FlowReleaseRow, "tag" | "taggedAt" | "verdict" | "rollbackOf" | "standing"> {
  return { tag, taggedAt: at(minute), verdict: "approved", standing: undefined, ...over };
}

function commit(
  subject: string,
  minute: number,
  over: Partial<CompareCommit> = {},
): Pick<CompareCommit, "sha" | "subject" | "authorName" | "at" | "change"> {
  return {
    sha: `${subject.length.toString(16)}${String(minute)}`.padEnd(40, "0"),
    subject,
    authorName: "Ines Vale",
    at: at(minute),
    change: null,
    ...over,
  };
}

const landed = (number: number, minute: number, title = `Change ${String(number)}`) =>
  pull({ number, title, merged: true, mergedAt: at(minute) });

/** Newest first, as the flow lists them: v0.1.1 runs production. */
const RELEASES = [release("v0.1.1", 30, { standing: "live" }), release("v0.1.0", 10)];

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
    const history = historyReleases({ releases: RELEASES, merged, commits: [] });
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

  it("History shows a GitHub merge commit as no row of its own", () => {
    const history = historyReleases({
      releases: RELEASES,
      merged: [landed(2, 20)],
      commits: [
        commit("Merge pull request #16 from fxck/mate/13-hide-sold-out", 21),
        commit("Merge branch 'main' into mate/13-hide-sold-out", 19),
        // The Mate's own commits that merge brought: its change's, never someone's outside it.
        commit("Hide sold out switch remembered across visits (#14)", 18, {
          authorName: "mate-s-r-o-mate[bot]",
        }),
        commit("Change 2", 20, { change: { number: 2, title: "Change 2", mateProjectId: "w" } }),
      ],
    });
    expect(history.map((row) => [row.tag, titles(row), row.outside])).toEqual([
      ["v0.1.1", ["Change 2"], []],
      ["v0.1.0", [], []],
    ]);
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

  it("a person's direct push on main shows inside its release as a commit outside Mate, its title without GitHub's (#n)", () => {
    const history = historyReleases({
      releases: RELEASES,
      merged: [],
      commits: [
        commit("Bump the footer year (#3)", 22, { authorName: "Ines Vale" }),
        commit("Not released yet", 50, { authorName: "Ines Vale" }),
      ],
    });
    expect(history.map((row) => [row.tag, row.outside.map((line) => line.subject)])).toEqual([
      ["v0.1.1", ["Bump the footer year"]],
      ["v0.1.0", []],
    ]);
  });

  it.each([
    {
      case: "the release production runs reads Live, the one it rolled back from Rolled back",
      releases: [
        release("v0.1.3", 50, { standing: "live", rollbackOf: "v0.1.1" }),
        release("v0.1.2", 40),
        release("v0.1.1", 30),
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
        release("v0.1.2", 45, { standing: "live" }),
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
      commits: [],
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
      const rows = historyReleases({ releases, merged: [], commits: [] });
      const drawn = shownReleases(rows, all);
      expect([drawn.rows.length, drawn.all]).toEqual([shown, more]);
    },
  );
});
