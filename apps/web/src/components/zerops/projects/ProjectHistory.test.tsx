// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vite-plus/test";

import { RecordedStageHistory } from "../RecordedStageHistory";
import { pull } from "./flowTestFixtures";
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
  failure: undefined,
  backTo: undefined,
  changes: [],
  outsideCommitCount: 2,
  recorded: [],
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
  await act(async () => host!.querySelector<HTMLButtonElement>("[aria-expanded]")!.click());
  expect(host!.textContent).toContain("1 commit outside Mate");
  expect(host!.textContent).not.toContain("Fix the VAT rounding");
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
        releases={[
          {
            ...RELEASE,
            recorded: [{ repository: "app", number: 2, title: "Change 2", pull: undefined }],
            outsideCommitCount: 0,
          },
        ]}
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
