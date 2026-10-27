// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { RecordedStageHistory } from "../RecordedStageHistory";
import { pull } from "./flowTestFixtures";
import type { GitRepoAt } from "../gitBrowser/GitBrowserLink";
import { ProjectHistory, ProjectHistoryView } from "./ProjectHistory";
import type { HistoryRelease } from "./projectHistory.logic";

const comparisons = vi.hoisted(() => ({
  reads: [] as unknown[],
  subject: "Fix the VAT rounding",
  byHead: {} as Record<string, import("@t3tools/shared/hqChanges").CompareCommit[]>,
}));
vi.mock("~/zerops/useReleaseComparisons", async () => {
  const { compareReadKey } = await import("@t3tools/client-runtime/zerops");
  return {
    useReleaseComparisons: (
      asks: ReadonlyMap<string, readonly import("@t3tools/client-runtime/zerops").CompareRead[]>,
    ) =>
      new Map(
        [...asks].map(([appId, reads]) => {
          comparisons.reads.push(...reads);
          return [
            appId,
            {
              answers: new Map(
                reads.map((read) => [
                  compareReadKey(read),
                  {
                    base: null,
                    head: read.query.head,
                    commits: comparisons.byHead[read.query.head] ?? [
                      {
                        sha: FIX,
                        subject: comparisons.subject,
                        authorName: "Ada",
                        at: "2026-10-20T08:00:00Z",
                        change: null,
                      },
                      {
                        sha: BUMP,
                        subject: "Bump the lockfile",
                        authorName: "Ada",
                        at: "2026-10-20T08:00:00Z",
                        change: null,
                      },
                    ],
                    total: 1,
                    truncated: false,
                  },
                ]),
              ),
              failures: new Map(),
            },
          ];
        }),
      ),
  };
});

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

const FIX = "f1".padEnd(40, "0");
const BUMP = "b2".padEnd(40, "0");
const RELEASE: HistoryRelease = {
  tag: "v1.0.4",
  taggedAt: "2026-10-20T09:00:00Z",
  state: "live",
  backTo: undefined,
  changes: [],
  outsideCommitCount: 2,
  changeTitles: [],
  ranges: [{ repo: "app", base: null, head: FIX }],
};

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  comparisons.reads = [];
  comparisons.subject = "Fix the VAT rounding";
  comparisons.byHead = {};
});

/** The History with its release and its commits outside Mate opened: their links into the browser. */
async function outsideLinks(repo: GitRepoAt | undefined) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ProjectHistoryView
        face={() => null}
        mateName={() => undefined}
        onOpen={() => {}}
        releases={[RELEASE]}
        repo={repo}
      />,
    ),
  );
  const press = (words: string) =>
    act(async () =>
      [...host!.querySelectorAll("button")]
        .find((button) => button.textContent?.includes(words))!
        .click(),
    );
  if (repo !== undefined) {
    await press("v1.0.4");
    expect(host.textContent).toContain("Fix the VAT rounding");
  }
  return [...host.querySelectorAll("a")].map((link) => [
    link.textContent,
    link.getAttribute("href"),
  ]);
}

describe("ProjectHistoryView: commits outside Mate in the Git browser", () => {
  it("each commit outside Mate opens its page in the Git browser", async () => {
    expect(await outsideLinks({ appId: "shop", repo: "app" })).toEqual([
      ["Fix the VAT rounding", `/git?appId=shop&repo=app&rev=${FIX}&view=commit`],
      ["Bump the lockfile", `/git?appId=shop&repo=app&rev=${BUMP}&view=commit`],
    ]);
  });

  it("links nothing where the project's repository is not known", async () => {
    expect(await outsideLinks(undefined)).toEqual([]);
  });
});

async function recordedHistory() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const flow = {
    environments: [{ versionRepository: "app" }],
    repos: [{ name: "app", mainHead: FIX, updatedAt: "2026-10-20T09:00:00Z" }],
    releasesKnown: true,
    releases: [
      {
        tag: "v1.0.4",
        taggedAt: "2026-10-20T09:00:00Z",
        history: {
          changes: [{ repo: "app", number: 3, title: "Fix checkout" }],
          commitCount: 2,
          outsideCommitCount: 1,
          ranges: [{ repo: "app", base: BUMP, head: FIX }],
        },
      },
    ],
    merged: [],
  } as unknown as import("~/zerops/projectFlows").ZeropsProjectFlow;
  await act(async () =>
    root!.render(
      <ProjectHistory
        groupId="shop"
        flow={flow}
        face={() => null}
        mateName={() => undefined}
        onOpen={() => {}}
      />,
    ),
  );
}

it("Application and environment history summaries show recorded releases and changes without opening Git.", async () => {
  await recordedHistory();
  expect(comparisons.reads).toEqual([]);
  expect(host!.textContent).toContain("v1.0.4");
  expect(host!.textContent).toContain("Fix checkout");
  expect(host!.textContent).toContain("1 commit outside Mate");
  expect(host!.textContent).not.toContain("Fix the VAT rounding");
});

it("A release row expands to its commit messages only when the person asks.", async () => {
  await recordedHistory();
  expect(comparisons.reads).toEqual([]);
  await act(async () =>
    [...host!.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("v1.0.4"))!
      .click(),
  );
  expect(comparisons.reads).toEqual([
    { repository: "app", query: { head: FIX, base: BUMP }, services: [] },
  ]);
  expect(host!.textContent).toContain("Fix the VAT rounding");
});

it("a person's direct push on main shows inside its release as a commit outside Mate, its title without GitHub's (#n)", async () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 19, 9, minute)).toISOString();
  const released = {
    sha: FIX,
    subject: "Bump the footer year (#3)",
    authorName: "Ines Vale",
    at: at(22),
    change: null,
  };
  const later = {
    sha: BUMP,
    subject: "Not released yet",
    authorName: "Ines Vale",
    at: at(50),
    change: null,
  };
  comparisons.byHead = { [FIX]: [released], [BUMP]: [later, released] };
  await recordedHistory();
  expect(host!.textContent).toContain("1 commit outside Mate");
  expect(host!.textContent).not.toContain("Bump the footer year");
  await act(async () =>
    [...host!.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("v1.0.4"))!
      .click(),
  );
  expect(host!.textContent).toContain("Bump the footer year");
  expect(host!.textContent).not.toContain("(#3)");
  expect(host!.textContent).not.toContain("Not released yet");
});

it("Stage history accepts recorded changes arriving after first paint without opening Git.", async () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const repo = { appId: "shop", repo: "app" };
  await act(async () =>
    root!.render(<RecordedStageHistory repo={repo} changes={undefined} publication={undefined} />),
  );
  expect(host.textContent).toContain("Reading recorded changes");
  await act(async () =>
    root!.render(
      <RecordedStageHistory
        repo={repo}
        changes={[pull({ title: "Fix checkout", merged: true })]}
        publication={{ name: "app", mainHead: FIX, updatedAt: "2026-10-20T09:00:00Z" }}
      />,
    ),
  );
  expect(host.textContent).toContain("Fix checkout");
  expect(host.textContent).toContain(FIX.slice(0, 7));
  expect(host.querySelector("a")?.getAttribute("href")).toBe(
    "/git?appId=shop&repo=app&view=commits",
  );
  expect(comparisons.reads).toEqual([]);
});

it("History shows a GitHub merge commit as no row of its own", async () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 19, 9, minute)).toISOString();
  comparisons.byHead[FIX] = [
    {
      sha: "1".repeat(40),
      subject: "Merge pull request #16 from fxck/mate/13-hide-sold-out",
      authorName: "Ines Vale",
      at: at(21),
      change: null,
    },
    {
      sha: "2".repeat(40),
      subject: "Merge branch 'main' into mate/13-hide-sold-out",
      authorName: "Ines Vale",
      at: at(19),
      change: null,
    },
    {
      sha: "3".repeat(40),
      subject: "Hide sold out switch remembered across visits (#14)",
      authorName: "mate-s-r-o-mate[bot]",
      at: at(18),
      change: null,
    },
    {
      sha: "4".repeat(40),
      subject: "Change 2",
      authorName: "Ines Vale",
      at: at(20),
      change: { number: 2, title: "Change 2", mateProjectId: "w" },
    },
  ];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ProjectHistoryView
        releases={[{ ...RELEASE, changeTitles: ["Change 2"], outsideCommitCount: 0 }]}
        repo={{ appId: "shop", repo: "app" }}
        face={() => null}
        mateName={() => undefined}
        onOpen={() => {}}
      />,
    ),
  );
  expect(comparisons.reads).toEqual([]);
  expect(host.textContent).toContain("Change 2");
  for (const commit of comparisons.byHead[FIX].slice(0, 3))
    expect(host.textContent).not.toContain(commit.subject);
});
