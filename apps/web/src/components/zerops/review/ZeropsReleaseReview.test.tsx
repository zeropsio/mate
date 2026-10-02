/**
 * What a release's review says before the press: what goes out, and — where what production runs
 * on a service cannot be told — that it cannot, beside what does go out. A roll back's says what
 * leaves production and what comes back.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  ReleaseReviewView,
  RollbackReviewView,
  type ReleaseReviewViewProps,
  type RollbackReviewViewProps,
} from "./ZeropsReleaseReview";

const NOW = Date.parse("2026-10-02T10:00:00.000Z");

function render(over: Partial<ReleaseReviewViewProps>): string {
  return renderToStaticMarkup(
    <ReleaseReviewView
      fixer={undefined}
      gate={{ allowed: true }}
      hasStage={false}
      live="v0.1.56"
      name="Beviro"
      now={NOW}
      onClose={() => {}}
      onFix={() => {}}
      onRelease={() => {}}
      outcome={{ kind: "offered" }}
      permission={{ allowed: true }}
      press={{ kind: "idle" }}
      rows={[]}
      services={["app"]}
      tag="v0.1.57"
      untold={[]}
      where={[{ service: "app", line: "redeploys from 3fa9c21" }]}
      {...over}
    />,
  );
}

describe("ReleaseReviewView", () => {
  it("says what production runs on a service cannot be told, under what goes out", () => {
    const markup = render({ untold: ["web"] });
    expect(markup).toContain("What goes out");
    expect(markup).toContain("Can&#x27;t tell what web runs.");
  });
});

function renderRollback(over: Partial<RollbackReviewViewProps>): string {
  return renderToStaticMarkup(
    <RollbackReviewView
      comingBack={{ state: "known", rows: [], count: 0, atLeast: false }}
      leaving={{ state: "known", rows: [], count: 0, atLeast: false }}
      line="app 7e1c0d2"
      live="v0.1.57"
      name="Beviro"
      nextTag="v0.1.58"
      now={NOW}
      onClose={() => {}}
      onRollBack={() => {}}
      outcome={{ kind: "offered" }}
      permission={{ allowed: true }}
      press={{ kind: "idle" }}
      services={["app"]}
      tag="v0.1.55"
      untold={[]}
      where={[{ service: "app", line: "goes back to 7e1c0d2" }]}
      {...over}
    />,
  );
}

describe("RollbackReviewView", () => {
  it("lists what leaves production by each change's title and its Mate, and says nothing comes back", () => {
    const markup = renderRollback({
      leaving: {
        state: "known",
        rows: [
          {
            key: "aaa111",
            title: "#54 Quicker gallery",
            change: { repository: "appdev", number: 54 },
            mateProjectId: "p-juno",
            mergedAt: "2026-10-01T10:00:00.000Z",
            stage: "none",
            sub: "Juno · merged 1 day ago",
          },
        ],
        count: 1,
        atLeast: false,
      },
    });
    expect(markup).toContain("Leaves production");
    expect(markup).toContain("#54 Quicker gallery");
    expect(markup).toContain("Juno · merged 1 day ago");
    expect(markup).toContain("Comes back");
    expect(markup).toContain("Nothing comes back.");
  });

  const row = (key: string) => ({
    key,
    title: `Commit ${key}`,
    change: undefined,
    mateProjectId: undefined,
    mergedAt: undefined,
    stage: "none" as const,
    sub: "",
  });

  it.each<{
    readonly name: string;
    readonly over: Partial<RollbackReviewViewProps>;
    readonly says: ReadonlyArray<string>;
  }>([
    {
      name: "HQ still comparing",
      over: { leaving: { state: "reading" }, comingBack: { state: "reading" } },
      says: ["Leaves production", "Comes back", "Comparing in HQ…"],
    },
    {
      name: "HQ unable to compare",
      over: { leaving: { state: "failed", reason: "HQ has no such commit." } },
      says: ["Can&#x27;t tell what leaves production: HQ has no such commit."],
    },
    {
      name: "more than HQ counts",
      over: {
        leaving: { state: "known", rows: [row("aaa111")], count: 10000, atLeast: true },
      },
      says: ["10000+ changes", "Commit aaa111"],
    },
    {
      name: "a service whose commit cannot be told",
      over: { untold: ["web"] },
      says: ["Nothing leaves production.", "Can&#x27;t tell what web runs."],
    },
    {
      name: "commits that come back",
      over: {
        comingBack: {
          state: "known",
          rows: [row("bbb222"), row("ccc333")],
          count: 2,
          atLeast: false,
        },
      },
      says: ["2 changes", "Commit bbb222", "Commit ccc333"],
    },
  ])("says $name", ({ over, says }) => {
    const markup = renderRollback(over);
    for (const words of says) expect(markup).toContain(words);
  });
});
