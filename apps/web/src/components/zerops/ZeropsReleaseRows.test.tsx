import {
  flowVerbKey,
  releaseRow,
  type FlowRelease,
  type FlowReleaseRow,
  type Moved,
  type MovedCommits,
  type ReleaseDeployFailure,
} from "@t3tools/client-runtime/zerops";
import type { CompareCommit } from "@t3tools/shared/hqChanges";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { elementsOf, press, readableText, TestNode } from "~/zerops/__fixtures__/testDom";

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
  taggedAt: "2026-09-25T07:00:00Z",
  ...overrides,
});

const PRODUCTION: ReadonlyMap<string, string> = new Map([["app", RUNS]]);
const NO_FAILURES: ReadonlyArray<ReleaseDeployFailure> = [];

/** The row as client-runtime words it: the component only draws it. */
const row = (
  from: FlowRelease,
  index: number,
  options: { live?: boolean; failed?: ReadonlyArray<ReleaseDeployFailure> } = {},
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
  failed: [{ tag: "v1.3.0", service: "app", sha: BROKE }],
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
    expect(html).toContain('data-zerops-surface="environment-name">v1.1.0</span>');
    expect(html).toContain('data-zerops-surface="environment-summary">app v1.1.0-sha</span>');
    expect(html).toMatch(/Roll back to this<\/button><\/span><\/li>/u);
  });
});

describe("ZeropsReleaseRows saying what a release carried", () => {
  const full = (short: string) => short.padEnd(40, "0");
  const FOUR_HOURS_AGO = "2026-09-19T08:00:00Z";
  const commit = (short: string, subject: string): CompareCommit => ({
    sha: full(short),
    subject,
    authorName: "ales",
    at: FOUR_HOURS_AGO,
    change: null,
  });
  /** What a release carried of one repository, as HQ compared it. */
  const moved = (repository: string, commits: ReadonlyArray<CompareCommit>): Moved => ({
    repository,
    services: [repository],
    commits,
    total: commits.length,
    truncated: false,
  });
  const known = (...carried: ReadonlyArray<Moved>): MovedCommits => ({
    state: "known",
    moved: carried,
  });
  const TITAN = moved("titan", [
    commit("1bcc930", "v0.23.0: the void (#32)"),
    commit("2cc0000", "Add the hangar"),
  ]);
  const API = moved("api", [commit("a100000", "Fix the cart")]);
  const WEB = moved("web", [
    commit("e200000", "Restyle the cart"),
    commit("e100000", "Add a footer"),
  ]);

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
  /** `tag → what it carried`: v0.1.27 the titan commits; v0.1.26 a roll-back, nothing new. */
  const carriedOf = (carried: ReadonlyArray<readonly [string, MovedCommits]>) => ({
    carried: new Map(carried),
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

  const TITAN_READ = carriedOf([
    ["v0.1.27", known(TITAN)],
    ["v0.1.26", known()],
  ]);
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
      carriedOf([["v2.0.1", known(API, WEB)]]),
      ["api: Fix the cart, +2 more", "ales · 4h · api a100000 · web e200000"],
      [],
    ],
    [
      "a release HQ is still comparing keeps its shas",
      NEWEST,
      carriedOf([["v0.1.27", { state: "reading" }]]),
      [">titan 1bcc930<"],
      ["v0.23.0", "aria-expanded"],
    ],
    [
      "a release that carried nothing new keeps its shas, and its name where the others are",
      row(TITAN_RELEASES[1]!, 1),
      TITAN_READ,
      [">titan 2cc0000<"],
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

  // e2e 2026-10-03: B's roll back to v0.1.0 made v0.1.2, whose row said only its shas.
  it("says what a roll back went back to, over its shas", () => {
    const back = (tag: string, short: string) =>
      release(tag, { line: `app ${short}`, entries: [{ service: "app", commit: full(short) }] });
    const shown = [back("v0.1.2", "30f75f9"), back("v0.1.1", "3a9c925"), back("v0.1.0", "30f75f9")];
    const html = renderToStaticMarkup(
      carriedRows(
        shown.map((entry, index) => row(entry, index)),
        carriedOf([["v0.1.2", known()]]),
      ),
    );
    expect(html).toMatch(
      /data-zerops-surface="release-description">Rolled back to v0\.1\.0<\/span><span[^>]*data-zerops-surface="release-byline">app 30f75f9</u,
    );
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
        TITAN_READ,
        ["v0.23.0: the void (#32)", "1bcc930", "Add the hangar", "2cc0000"],
      ],
      [
        "says why HQ could not compare it",
        NEWEST,
        carriedOf([["v0.1.27", { state: "failed", reason: "HQ has no such commit." }]]),
        ["HQ has no such commit."],
      ],
      [
        "lists each repository it moved, by the service it leads with",
        row(SPLIT_RELEASES[0]!, 1),
        carriedOf([["v2.0.1", known(API, WEB)]]),
        ["api", "Fix the cart", "web", "Restyle the cart"],
      ],
    ] as const)("%s", async (_case, shown, carried, has) => {
      const { text, expanded, label } = await opened(shown, carried);
      expect(expanded).toBe("true");
      expect(label).toBe(`Hide what ${shown.tag} carried`);
      for (const part of has) expect(text).toContain(part);
    });
  });
});
