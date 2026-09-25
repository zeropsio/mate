import {
  flowVerbKey,
  releaseRow,
  type FlowRelease,
  type FlowReleaseRow,
} from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsReleaseRows } from "./ZeropsReleaseRows";

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
