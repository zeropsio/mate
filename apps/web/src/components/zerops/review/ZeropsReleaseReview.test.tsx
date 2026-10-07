/**
 * What a release's review says before the press: what goes out, and — where what production runs
 * on a service cannot be told — that it cannot, beside what does go out. A roll back's says what
 * leaves production and what comes back.
 */
import { HQ_WRITE_UNCERTAIN } from "@t3tools/client-runtime/zerops/hq";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  ReleaseReviewView,
  RollbackReviewView,
  type ReleaseReviewViewProps,
  type RollbackReviewViewProps,
} from "./ZeropsReleaseReview";

const NOW = Date.parse("2026-10-02T10:00:00.000Z");

const DEPLOYS: HqDeployAnswer = {
  jobs: [
    {
      environment: "xyz-production",
      kind: "deploy",
      service: "app",
      sha: "96e2309".padEnd(40, "0"),
      job: "1",
      state: "building",
      processId: "process-1",
      behind: null,
      reason: null,
    },
  ],
  note: null,
};

function render(over: Partial<ReleaseReviewViewProps>): string {
  return renderToStaticMarkup(
    <ReleaseReviewView
      fixer={undefined}
      gate={{ allowed: true }}
      hasStage={false}
      name="Beviro"
      now={NOW}
      onClose={() => {}}
      onFix={() => {}}
      onRelease={() => {}}
      outcome={{ kind: "offered" }}
      permission={{ allowed: true }}
      press={{ kind: "idle" }}
      replaces={{ kind: "release", tag: "v0.1.56" }}
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

  // e2e 2026-10-03: B's v0.1.1, 8 s into its release, said "Can't tell what app runs.": the
  // service it redeploys is deploying, and is said so.
  it("says a service the release redeploys is deploying, while it releases", () => {
    const markup = render({
      outcome: { kind: "releasing" },
      services: ["app"],
      untold: ["app", "web"],
    });
    expect(markup).toContain("app is deploying.");
    expect(markup).toContain("Can&#x27;t tell what web runs.");
    expect(markup).not.toContain("Can&#x27;t tell what app runs.");
  });

  // F22: a release whose answer was lost, and HQ holds none of it when asked again.
  it("says to check the project, and offers Release again, when HQ could not confirm the release", () => {
    const markup = render({ press: { kind: "refused", reason: HQ_WRITE_UNCERTAIN } });
    expect(markup).toContain("Check the project before trying again.");
    const button = /<button[^>]*>(?:(?!<\/button>).)*Release(?:(?!<\/button>).)*<\/button>/u.exec(
      markup,
    )?.[0];
    expect(button).toBeDefined();
    expect(button).not.toContain("disabled");
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

  it("opens a change it lists in its review, as history does", () => {
    const markup = renderRollback({
      onOpenChange: () => {},
      leaving: {
        state: "known",
        rows: [
          {
            key: "aaa111",
            title: "#54 Quicker gallery",
            change: { repository: "appdev", number: 54 },
            mateProjectId: "p-juno",
            mergedAt: undefined,
            stage: "none",
            sub: "Juno",
          },
        ],
        count: 1,
        atLeast: false,
      },
    });
    expect(markup).toMatch(/<button[^>]*data-release-row="aaa111"/u);
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

describe("a review's deploy answer belongs to its service in Where", () => {
  it.each(["release", "rollback"] as const)(
    "says the %s deploy once, inside the content section",
    (kind) => {
      const markup =
        kind === "release"
          ? render({
              press: { kind: "done", deploys: DEPLOYS },
              outcome: { kind: "releasing" },
              untold: ["app"],
            })
          : renderRollback({
              press: { kind: "done", deploys: DEPLOYS },
              outcome: { kind: "releasing" },
              untold: ["app"],
            });
      const document = new Window().document;
      document.body.innerHTML = markup;
      const job = document.querySelector('[data-zerops-job-state="building"]');
      expect(job?.closest("section")?.querySelector("h3")?.textContent).toBe("Where");
      expect(document.body.textContent.match(/96e2309/g)).toHaveLength(1);
      expect(document.body.textContent).not.toContain("app is deploying");
      expect(document.body.textContent).not.toContain("Can't tell what app runs");
      expect(document.body.textContent).not.toContain("redeploys from 3fa9c21");
      expect(document.body.textContent).not.toContain("goes back to 7e1c0d2");
    },
  );
});

describe("a roll back whose deploy outcome is unconfirmed", () => {
  // The same lost follow as a release: the person's own Mate can check the deploy (S6).
  const stalled = (fixer: string | undefined) =>
    renderRollback({
      fixer,
      onFix: () => {},
      outcome: { kind: "stalled", at: new Date(NOW - 31 * 60_000).toISOString() },
      press: { kind: "done" },
    });

  it("says so, and offers the person's Mate to check it", () => {
    const markup = stalled("Juno");
    expect(markup).toContain("Deploy status unknown for v0.1.58");
    expect(markup).toContain("Ask Juno to check it");
  });

  it("offers no Mate when the person has none", () => {
    expect(stalled(undefined)).not.toContain("Ask ");
  });
});

it("a failed release comparison offers Compare again", () => {
  expect(
    render({ comparisonFailure: { reason: "HQ did not answer.", again: () => {} } }),
  ).toContain("Compare again");
});
it("a failed rollback comparison offers Compare again", () => {
  expect(
    renderRollback({ leaving: { state: "failed", reason: "HQ did not answer.", again: () => {} } }),
  ).toContain("Compare again");
});
