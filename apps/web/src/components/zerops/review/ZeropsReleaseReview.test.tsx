/**
 * What a release's review says before the press: what goes out, and — where what production runs
 * on a service cannot be told — that it cannot, beside what does go out. A roll back's says what
 * leaves production and what comes back.
 */
import { RELEASE_CHECKING } from "@t3tools/client-runtime/zerops";
import { HQ_WRITE_UNCERTAIN } from "@t3tools/client-runtime/zerops/hq";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import type { ReleaseServicePlan } from "@t3tools/shared/hqRelease";
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

const CREATION_PLAN: ReleaseServicePlan = {
  hash: "a".repeat(64),
  operations: [
    {
      kind: "create",
      service: "worker",
      settings: { hostname: "worker", type: "nodejs@22", minContainers: 2 },
      cost: "Creates one additional billed production service: worker.",
    },
    { kind: "deploy", service: "worker", sha: "d".repeat(40) },
  ],
};

describe("ReleaseReviewView", () => {
  it("names every missing Production service before approval and disables Release", () => {
    const reason =
      "Production has no services agentrunner, worker. Releases cannot create services in Production yet.";
    const page = new Window().document;
    page.body.innerHTML = render({ gate: { allowed: false, reason } });
    expect(page.body.textContent).toContain(reason.replace(/\.$/u, ""));
    expect(page.querySelector("[data-review-primary]")?.hasAttribute("disabled")).toBe(true);
  });

  it("shows each ordered production operation, its exact creation settings and billed consequence before enabled approval", () => {
    const page = new Window().document;
    page.body.innerHTML = render({ servicePlan: CREATION_PLAN });
    const operations = [...page.querySelectorAll("section")].find(
      (section) => section.querySelector("h3")?.textContent === "Production operations",
    );
    const rows = [...(operations?.querySelectorAll("ol > li") ?? [])];
    expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual([
      "Create worker",
      "Deploy worker",
    ]);
    expect([...rows[1]!.querySelectorAll("p")].map((line) => line.textContent)).toEqual([
      "Deploy worker",
      "dddddddddddddddddddddddddddddddddddddddd",
    ]);
    const creation = operations?.querySelector("[data-zerops-surface=release-import]");
    expect(creation?.querySelector("pre")?.textContent).toBe(
      "services:\n  - hostname: worker\n    type: nodejs@22\n    minContainers: 2\n",
    );
    expect(creation?.querySelector(".rv-note")?.textContent).toBe(
      "Adds one billed service; Zerops charges their resources by these settings. Release runs it before it deploys.",
    );
    expect(page.querySelector("[data-review-primary]")?.hasAttribute("disabled")).toBe(false);
  });

  it.each([
    { who: "who may release", run: async () => {}, actions: ["Create in production", "Copy YAML"] },
    { who: "who may not", run: undefined, actions: ["Copy YAML"] },
  ])(
    "the import that creates production's missing services is run from the review by whoever may release: $who",
    ({ run, actions }) => {
      const page = new Window().document;
      page.body.innerHTML = render({ servicePlan: CREATION_PLAN, onImportServices: run });
      const creation = page.querySelector("[data-zerops-surface=release-import]");
      expect([...(creation?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toEqual(
        actions,
      );
    },
  );

  it.each([
    {
      state: "pending",
      props: { servicePlanPending: true },
      message: "Reading production operations…",
      actions: [],
    },
    {
      state: "failed",
      props: {
        servicePlanFailure: "Production plan changed; review it again.",
        onRetryServicePlan: () => {},
      },
      message: "Production plan changed; review it again.",
      actions: ["Review again"],
    },
  ])(
    "a $state production review withholds the old plan and disables approval",
    ({ props, message, actions }) => {
      const page = new Window().document;
      page.body.innerHTML = render({ servicePlan: CREATION_PLAN, ...props });
      const operations = [...page.querySelectorAll("section")].find(
        (section) => section.querySelector("h3")?.textContent === "Production operations",
      );
      expect(operations?.textContent).toContain(message);
      expect(operations?.querySelector("ol")).toBeNull();
      expect(
        [...(operations?.querySelectorAll("button") ?? [])].map((button) => button.textContent),
      ).toEqual(actions);
      expect(page.querySelector("[data-review-primary]")?.hasAttribute("disabled")).toBe(true);
    },
  );

  // The onboarding run: released, the sheet's one button was "Put it on your domain" and the
  // production address stood small and grey behind the scrim.
  it("ends a release on the live app: Open its address, a domain of its own beside it", () => {
    const markup = render({
      outcome: { kind: "released", at: undefined },
      production: {
        at: undefined,
        parts: [],
        addresses: [{ service: "app", url: "https://app-abcd-3000.prg1.zerops.app" }],
      },
      onAddDomain: () => {},
    });
    const page = new Window().document;
    page.body.innerHTML = markup;
    const primary = page.querySelector("[data-review-primary]");
    expect(primary?.textContent).toContain("Open app-abcd-3000.prg1.zerops.app");
    expect(page.querySelector("[data-review-secondary]")?.textContent).toBe(
      "Put it on your domain",
    );
  });

  // The run: released, "Close" stood alone on a line of its own under Open and the domain, beside
  // the panel's ×: a third way out where the panel's last word is the live app.
  it("ends a release with its way into the live app and no Close beside it: the panel's × closes it", () => {
    const markup = render({
      outcome: { kind: "released", at: undefined },
      production: {
        at: undefined,
        parts: [],
        addresses: [{ service: "app", url: "https://app-abcd-3000.prg1.zerops.app" }],
      },
      onAddDomain: () => {},
    });
    const page = new Window().document;
    page.body.innerHTML = markup;
    const words = [...page.querySelectorAll(".rv-btns button")].map((button) => button.textContent);
    expect(words).not.toContain("Close");
  });

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

  // The run: a first release opened on an editable "0.1.0", "Must be newer than every release.
  // Next patch is v0.1.0.", "Use v1.0.0 · Set in the code, in package.json" — with no release
  // before it, semver and package.json are questions nobody asked.
  it("names a first release's version in words, its field and rules behind Change", () => {
    const version = {
      value: "0.1.0",
      onChange: () => {},
      tags: [],
      suggestions: [{ tag: "v1.0.0", source: "app/package.json" }],
      nextPatch: "v0.1.0",
    };
    const page = new Window().document;
    page.body.innerHTML = render({ version, replaces: { kind: "first" } });
    const section = [...page.querySelectorAll("section")].find(
      (each) => each.querySelector("h3")?.textContent === "Version",
    );
    expect(section?.textContent).toContain("v0.1.0");
    expect(section?.querySelector("input")).toBeNull();
    expect(section?.textContent).not.toContain("package.json");
    expect(section?.textContent).not.toContain("Next patch");
    expect(
      [...(section?.querySelectorAll("button") ?? [])].map((each) => each.textContent),
    ).toEqual(["Change"]);
  });

  // The live check of 0.15.144: released v0.1.1, the review still said "Production now: Runs
  // v0.1.0 since 21:44" — the old release, at the new one's time.
  it("says what production ran before the release only until production runs the release", () => {
    const production = {
      at: "2026-10-16T09:16:00Z",
      parts: [{ hostname: "app", version: "v0.1.56" }],
      addresses: [{ service: "app", url: "https://app-abcd-3000.prg1.zerops.app" }],
    };
    expect(render({ production })).toContain("Production now");
    expect(render({ production, outcome: { kind: "releasing" } })).toContain("Production now");
    expect(
      render({ production, outcome: { kind: "released", at: "2026-10-16T19:46:00Z" } }),
    ).not.toContain("Production now");
  });

  // The live check of 0.15.144: a later release offered "Use v1.0.0 · Set in the code, in
  // package.json".
  it("names a later release's suggested version in plain words, never a file", () => {
    const version = {
      value: "0.1.57",
      onChange: () => {},
      tags: ["v0.1.56"],
      suggestions: [{ tag: "v1.0.0", source: "app/package.json" }],
      nextPatch: "v0.1.57",
    };
    const markup = render({ version });
    expect(markup).toContain("Your code names v1.0.0.");
    expect(markup).toContain("Use it");
    expect(markup).not.toContain("package.json");
  });

  // The onboarding run: at the press the Version block went and the foot rose 110 px under the
  // pointer, then Where came and it dropped 76 px.
  it("keeps its Version, not to be changed, from the press until Where takes its place", () => {
    const version = {
      value: "0.1.57",
      onChange: () => {},
      tags: ["v0.1.56"],
      suggestions: [],
      nextPatch: "v0.1.57",
    };
    const sections = (markup: string) => {
      const page = new Window().document;
      page.body.innerHTML = markup;
      return {
        titles: [...page.querySelectorAll("h3")].map((title) => title.textContent),
        locked: page.querySelector('input[aria-label="Version"]')?.hasAttribute("disabled"),
      };
    };
    expect(
      sections(
        render({ version, outcome: { kind: "releasing" }, press: { kind: "running" } as const }),
      ),
    ).toMatchObject({ titles: expect.arrayContaining(["Version"]), locked: true });
    const answered = sections(
      render({
        version,
        outcome: { kind: "releasing" },
        press: { kind: "done", deploys: DEPLOYS },
      }),
    );
    expect(answered.titles).toContain("Where");
    expect(answered.titles).not.toContain("Version");
  });

  // The onboarding run: the panel opened on "0 changes, the first release · Can't release now"
  // for 0.4 s while it compared what goes out.
  it("says no count and no refusal while it compares what goes out", () => {
    const markup = render({
      gate: { allowed: false, reason: RELEASE_CHECKING },
      replaces: { kind: "first" },
    });
    expect(markup).toContain("The first release");
    expect(markup).toContain("Checking what goes out");
    expect(markup).not.toContain("0 changes");
    expect(markup).not.toContain("Can&#x27;t release now");
  });

  // F22: a release whose answer was lost, and HQ holds none of it when asked again.
  it("says to check the project, and offers Release again, when HQ could not confirm the release", () => {
    const markup = render({ press: { kind: "refused", reason: HQ_WRITE_UNCERTAIN } });
    expect(markup).toContain("Check the project before trying again.");
    const button = /<button[^>]*>(?:(?!<\/button>).)*Release(?:(?!<\/button>).)*<\/button>/u.exec(
      markup,
    )?.[0];
    expect(button).toBeDefined();
    expect(button).not.toMatch(/\sdisabled(?:=""|[\s>])/u);
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
    expect(markup.replace(/<[^>]*>/gu, "")).toContain("#54 Quicker gallery");
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
      expect(document.querySelectorAll("[data-zerops-job-state]")).toHaveLength(1);
      expect(document.body.textContent).not.toContain("96e2309");
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

describe("a release's code in the Git browser", () => {
  const SHA = "7e1c0d2".padEnd(40, "0");
  const API = "5b8a903".padEnd(40, "0");
  /** Every link into the Git browser: its words and its address. */
  const gitLinks = (markup: string) => {
    const document = new Window().document;
    document.body.innerHTML = markup;
    return [...document.querySelectorAll("a")]
      .filter((link) => link.getAttribute("href")?.startsWith("/git?") === true)
      .map((link) => [link.textContent?.replace(/\s+/gu, " ").trim(), link.getAttribute("href")]);
  };
  const unreviewed = {
    key: SHA,
    title: "Bump the VAT table",
    change: undefined,
    commit: { repository: "app", sha: SHA },
    mateProjectId: undefined,
    mergedAt: undefined,
    stage: "none" as const,
    sub: "",
  };
  const opened = [["Bump the VAT table", `/git?appId=shop&repo=app&rev=${SHA}&view=commit`]];

  it("a commit nobody reviewed opens its own page from what goes out", () => {
    expect(gitLinks(render({ appId: "shop", onOpenChange: () => {}, rows: [unreviewed] }))).toEqual(
      opened,
    );
  });

  it("a commit nobody reviewed opens its own page from what a roll back moves", () => {
    const list = { state: "known", rows: [unreviewed], count: 1, atLeast: false } as const;
    expect(
      gitLinks(renderRollback({ appId: "shop", onOpenChange: () => {}, comingBack: list })),
    ).toEqual(opened);
  });

  it.each([
    [
      "one service",
      [{ service: "app", repository: "app", sha: SHA }],
      [["Browse files", `/git?appId=shop&repo=app&rev=${SHA}&view=code`]],
    ],
    [
      "several, each by its name",
      [
        { service: "api", repository: "api", sha: API },
        { service: "app", repository: "app", sha: SHA },
      ],
      [
        ["api", `/git?appId=shop&repo=api&rev=${API}&view=code`],
        ["app", `/git?appId=shop&repo=app&rev=${SHA}&view=code`],
      ],
    ],
  ] as const)(
    "Production now browses the code production runs, never naming its hash: %s",
    (_case, productionCode, links) => {
      const markup = render({ appId: "shop", productionCode });
      expect(gitLinks(markup)).toEqual(links);
      const document = new Window().document;
      document.body.innerHTML = markup;
      expect(document.body.textContent).not.toContain("7e1c0d2");
    },
  );

  it("a roll back browses the code each service goes back to", () => {
    const markup = renderRollback({
      appId: "shop",
      where: [
        { service: "app", line: "goes back to 7e1c0d2", code: { repository: "app", sha: SHA } },
      ],
    });
    expect(gitLinks(markup)).toEqual([
      ["Browse files", `/git?appId=shop&repo=app&rev=${SHA}&view=code`],
    ]);
  });

  it("links nothing into the browser where it does not know the project's application", () => {
    const markup = render({
      rows: [unreviewed],
      onOpenChange: () => {},
      productionCode: [{ service: "app", repository: "app", sha: SHA }],
    });
    expect(gitLinks(markup)).toEqual([]);
  });
});

it("a release-review refusal carrying problems shows them; one with only code/reason renders as today", () => {
  const problem = {
    code: "invalid_recipe",
    what: "Unsupported field minCpu",
    where: { appId: "shop", service: "worker", tier: "production", file: "production.yaml" },
    rule: { source: "zerops-schema" as const, schemaPath: "#/additionalProperties" },
    next: { actor: "Mate", action: "Remove minCpu and use verticalAutoscaling" },
  };
  const page = new Window().document;
  for (const state of [
    { servicePlanFailure: "Recipe refused", servicePlanProblems: [problem] },
    { press: { kind: "refused" as const, reason: "Approval refused", problems: [problem] } },
    { problems: [problem] },
  ]) {
    page.body.innerHTML = render({ ...state, fixer: "Wren" });
    for (const value of [
      problem.what,
      "worker",
      "production.yaml",
      "#/additionalProperties",
      problem.next.action,
    ])
      expect(page.body.textContent).toContain(value);
    expect(page.body.textContent).toContain("Ask Wren to address it");
  }
  page.body.innerHTML = render({
    servicePlanFailure: "Legacy refusal",
    onRetryServicePlan: () => {},
  });
  expect(page.body.textContent).toContain("Legacy refusal");
  expect(page.body.textContent).toContain("Review again");
});
