import {
  flowVerbKey,
  releaseRow,
  releasesCarried,
  type FlowRelease,
  type FlowReleaseRow,
  type GiteaCommit,
} from "@t3tools/client-runtime/zerops";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { elementsOf, press, readableText, TestNode } from "~/zerops/__fixtures__/testDom";
import type { ZeropsCommitsState } from "~/zerops/useZeropsRepositoryCommits";

import { ZeropsReleaseRows } from "./ZeropsReleaseRows";

/** The rows' one clock, fixed: an age is the producer's to test, not the minute this ran in. */
const NOW = vi.hoisted(() => Date.parse("2026-09-19T12:00:00Z"));
vi.mock("~/zerops/useNowMs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNowMs: () => NOW,
}));

/** The test DOM, able to hold a chevron's SVG. */
class SvgDocument extends TestNode {
  createElementNS(_namespace: string, name: string) {
    return new TestNode(name, this);
  }
}

const GROUP = "shop";
const RUNS = "a".repeat(40);
const BROKE = "b".repeat(40);

const release = (tag: string, overrides: Partial<FlowRelease> = {}): FlowRelease => ({
  tag,
  verdict: "approved",
  detail: undefined,
  line: `app ${tag}-sha`,
  entries: [{ service: "app", commit: RUNS }],
  taggedAt: undefined,
  ...overrides,
});

const PRODUCTION: ReadonlyMap<string, string> = new Map([["app", RUNS]]);
const NO_FAILURES: ReadonlyMap<string, string | undefined> = new Map();

/** The row as client-runtime words it: the component only draws it. */
const row = (
  from: FlowRelease,
  index: number,
  options: { live?: boolean; failed?: ReadonlyMap<string, string | undefined> } = {},
): FlowReleaseRow =>
  releaseRow(from, index, {
    production: PRODUCTION,
    failed: options.failed ?? NO_FAILURES,
    live: options.live ?? false,
  });

const LIVE = row(release("v1.2.0"), 0, { live: true });
// An earlier release listing a commit production has moved on from: one listing what runs would
// be a roll back that changes nothing.
const EARLIER = row(
  release("v1.1.0", { entries: [{ service: "app", commit: "c".repeat(40) }] }),
  1,
);
const DEPLOY_FAILED = row(release("v1.3.0", { entries: [{ service: "app", commit: BROKE }] }), 0, {
  failed: new Map([[`app@${BROKE}`, undefined]]),
});
const REFUSED = row(
  release("v1.4.0", { verdict: "refused", detail: "The build of app failed." }),
  0,
);

const rows = (releases: ReadonlyArray<FlowReleaseRow>, pending: ReadonlySet<string> = new Set()) =>
  renderToStaticMarkup(
    <ul>
      <ZeropsReleaseRows
        groupId={GROUP}
        onRollBack={() => undefined}
        pending={pending}
        releases={releases}
      />
    </ul>,
  );

describe("ZeropsReleaseRows", () => {
  it.each([
    ["the release production runs reads Live and offers no way back", LIVE, "Live", false],
    ["an earlier approved release offers the way back to it", EARLIER, "Approved", true],
    ["a release whose deploy failed says so", DEPLOY_FAILED, "Deploy failed", false],
    ["a refused release says why", REFUSED, "Refused", false],
  ] as const)("%s", (_case, release, word, rollBack) => {
    const html = rows([release]);
    expect(html).toContain(`>${release.tag}<`);
    expect(html).toContain(word);
    expect(html.includes("Roll back to this")).toBe(rollBack);
  });

  it("writes a refused release's reason where its commits would be", () => {
    expect(rows([REFUSED])).toContain("The build of app failed.");
  });

  it("holds the way back while it runs, on that release only", () => {
    const html = rows(
      [EARLIER, row(release("v1.0.0", { entries: EARLIER.entries }), 2)],
      new Set([flowVerbKey({ kind: "roll-back", groupId: GROUP, tag: EARLIER.tag })]),
    );
    expect(html).toContain("Rolling back…");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Rolling back…/u);
    expect(html).toContain("Roll back to this");
  });

  it("is one row per release, and nothing for none", () => {
    expect(rows([LIVE, EARLIER]).match(/data-zerops-environment-row/gu)).toHaveLength(2);
    expect(rows([])).toBe("<ul></ul>");
  });
});

describe("ZeropsReleaseRows without the commits read", () => {
  it("is the row it was: no chevron, no expansion, the shas alone", () => {
    const html = rows([LIVE, EARLIER, REFUSED]);
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("release-carried");
    expect(html).toContain(
      '<span class="flex min-w-0 items-center gap-2.5"><span class="min-w-0 truncate text-sm text-foreground" data-zerops-surface="environment-name">v1.1.0</span>',
    );
    expect(html).toContain(
      '<span class="col-span-2 min-w-0 truncate text-xs text-muted-foreground sm:col-span-1" data-zerops-surface="environment-summary">app v1.1.0-sha</span>',
    );
    expect(html).toMatch(/Roll back to this<\/button><\/span><\/li>/u);
  });
});

describe("ZeropsReleaseRows saying what a release carried", () => {
  const full = (short: string) => short.padEnd(40, "0");
  const FOUR_HOURS_AGO = "2026-09-19T08:00:00Z";
  const commit = (short: string, subject: string, byline = false): GiteaCommit => ({
    sha: full(short),
    subject,
    ...(byline ? { author: "ales", at: FOUR_HOURS_AGO } : {}),
  });
  const TITAN: ReadonlyArray<GiteaCommit> = [
    commit("1bcc930", "v0.23.0: the void (#32)", true),
    commit("2cc0000", "Add the hangar"),
    commit("3dd0000", "The first ship"),
  ];
  const API: ReadonlyArray<GiteaCommit> = [
    commit("a100000", "Fix the cart", true),
    commit("a000000", "Open the shop"),
  ];
  const WEB: ReadonlyArray<GiteaCommit> = [
    commit("e200000", "Restyle the cart"),
    commit("e100000", "Add a footer"),
    commit("e000000", "Open the shop"),
  ];
  const read = (commits: ReadonlyArray<GiteaCommit>): ZeropsCommitsState => ({
    kind: "read",
    commits,
    releases: new Map(),
  });

  const titanRelease = (tag: string, short: string, overrides: Partial<FlowRelease> = {}) =>
    release(tag, {
      line: `titan ${short}`,
      entries: [{ service: "titan", commit: full(short) }],
      ...overrides,
    });
  /** Newest first; the list the rows show is its head, the carried is read over all of it. */
  const TITAN_RELEASES = [
    titanRelease("v0.1.27", "1bcc930"),
    titanRelease("v0.1.26", "2cc0000"),
    titanRelease("v0.1.25", "2cc0000"),
  ];
  const SPLIT_RELEASES = [
    release("v2.0.1", {
      line: "api a100000 · web e200000",
      entries: [
        { service: "api", commit: full("a100000") },
        { service: "web", commit: full("e200000") },
      ],
    }),
    release("v2.0.0", {
      line: "api a000000 · web e000000",
      entries: [
        { service: "api", commit: full("a000000") },
        { service: "web", commit: full("e000000") },
      ],
    }),
  ];
  const TITAN_ONLY = new Map([["titan", "titan"]]);
  const SPLIT = new Map([
    ["api", "api"],
    ["web", "web"],
  ]);

  const carriedOf = (
    releases: ReadonlyArray<FlowRelease>,
    repositoryOf: ReadonlyMap<string, string>,
    reads: ReadonlyMap<string, ZeropsCommitsState>,
  ) => ({
    changes: releasesCarried({
      releases,
      repositoryOf,
      commits: new Map(
        [...reads].flatMap(([repository, state]) =>
          state.kind === "read" ? [[repository, state.commits] as const] : [],
        ),
      ),
    }),
    reads,
    repositoryOf,
    forge: { giteaOrigin: undefined, owner: undefined },
    names: {},
  });

  const carriedRows = (
    shown: ReadonlyArray<FlowReleaseRow>,
    carried: ReturnType<typeof carriedOf>,
  ) => (
    <ul>
      <ZeropsReleaseRows
        carried={carried}
        groupId={GROUP}
        onRollBack={() => undefined}
        pending={new Set()}
        releases={shown}
      />
    </ul>
  );

  const TITAN_READ = carriedOf(TITAN_RELEASES, TITAN_ONLY, new Map([["titan", read(TITAN)]]));
  const NEWEST = row(TITAN_RELEASES[0]!, 1);

  it.each([
    [
      "a release that moved one repository says its commit, who and when, over the shas",
      NEWEST,
      TITAN_READ,
      ["v0.23.0: the void (#32)", "ales · 4h · titan 1bcc930", 'aria-expanded="false"'],
      [],
    ],
    [
      "a release that moved two repositories names the one it leads with and counts the rest",
      row(SPLIT_RELEASES[0]!, 1),
      carriedOf(
        SPLIT_RELEASES,
        SPLIT,
        new Map([
          ["api", read(API)],
          ["web", read(WEB)],
        ]),
      ),
      ["api: Fix the cart, +2 more", "ales · 4h · api a100000 · web e200000"],
      [],
    ],
    [
      "a release whose commits are still being read keeps its shas and a way to open it",
      NEWEST,
      carriedOf(TITAN_RELEASES, TITAN_ONLY, new Map([["titan", { kind: "reading" }]])),
      [">titan 1bcc930<", 'aria-expanded="false"'],
      ["v0.23.0"],
    ],
    [
      "a release that carried nothing new keeps its shas, and its name where the others are",
      row(TITAN_RELEASES[1]!, 1),
      TITAN_READ,
      [">titan 2cc0000<", '<span aria-hidden="true" class="size-5 shrink-0"></span>'],
      ["aria-expanded"],
    ],
    [
      "a refused release keeps saying why",
      row(
        titanRelease("v0.1.27", "1bcc930", {
          verdict: "refused",
          detail: "The build of titan failed.",
        }),
        0,
      ),
      TITAN_READ,
      [">The build of titan failed.<"],
      ["v0.23.0"],
    ],
  ] as const)("%s", (_case, shown, carried, has, lacks) => {
    const html = renderToStaticMarkup(carriedRows([shown], carried));
    for (const text of has) expect(html).toContain(text);
    for (const text of lacks) expect(html).not.toContain(text);
    expect(html.match(/data-zerops-environment-row/gu)).toHaveLength(1);
  });

  it("is still one row per release", () => {
    const html = renderToStaticMarkup(
      carriedRows(
        TITAN_RELEASES.map((each, index) => row(each, index + 1)),
        TITAN_READ,
      ),
    );
    expect(html.match(/data-zerops-environment-row/gu)).toHaveLength(3);
  });

  describe("opened", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const opened = async (shown: FlowReleaseRow, carried: ReturnType<typeof carriedOf>) => {
      const document = new SvgDocument("#document", null, 9);
      vi.stubGlobal("document", document);
      vi.stubGlobal("window", { document, HTMLIFrameElement: TestNode });
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const container = document.createElement("div");
      const root = createRoot(container as unknown as Element);
      await act(async () => {
        root.render(carriedRows([shown], carried));
      });
      const chevron = elementsOf(container, "button").find(
        (button) => button.getAttribute("aria-label") === `Show what ${shown.tag} carried`,
      );
      expect(chevron).toBeDefined();
      await act(async () => {
        press(chevron!);
      });
      // What the row opened onto, apart from the row's own lines that already name the head.
      const expansion = elementsOf(container, "div").find(
        (node) => node.getAttribute("data-zerops-surface") === "release-carried",
      );
      const text = expansion === undefined ? "" : readableText(expansion);
      const expanded = chevron!.getAttribute("aria-expanded");
      const label = chevron!.getAttribute("aria-label");
      await act(async () => {
        root.unmount();
      });
      return { text, expanded, label };
    };

    it.each([
      [
        "lists the commits it carried, each with its short sha",
        NEWEST,
        carriedOf(
          [TITAN_RELEASES[0]!, titanRelease("v0.1.20", "3dd0000")],
          TITAN_ONLY,
          new Map([["titan", read(TITAN)]]),
        ),
        ["v0.23.0: the void (#32)", "1bcc930", "Add the hangar", "2cc0000"],
      ],
      [
        "says the history is being read",
        NEWEST,
        carriedOf(TITAN_RELEASES, TITAN_ONLY, new Map([["titan", { kind: "reading" }]])),
        ["Reading the history\u2026"],
      ],
      [
        "says why the history could not be read",
        NEWEST,
        carriedOf(
          TITAN_RELEASES,
          TITAN_ONLY,
          new Map([["titan", { kind: "failed", reason: "Gitea answered 502." }]]),
        ),
        ["Gitea answered 502."],
      ],
      [
        "lists one repository's commits and says why another's could not be read",
        row(SPLIT_RELEASES[0]!, 1),
        carriedOf(
          SPLIT_RELEASES,
          SPLIT,
          new Map<string, ZeropsCommitsState>([
            ["api", read(API)],
            ["web", { kind: "failed", reason: "Gitea answered 502." }],
          ]),
        ),
        ["api", "Fix the cart", "web", "Gitea answered 502."],
      ],
    ] as const)("%s", async (_case, shown, carried, has) => {
      const { text, expanded, label } = await opened(shown, carried);
      expect(expanded).toBe("true");
      expect(label).toBe(`Hide what ${shown.tag} carried`);
      for (const part of has) expect(text).toContain(part);
    });
  });
});
