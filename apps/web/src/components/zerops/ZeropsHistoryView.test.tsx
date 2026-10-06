import type { CompareCommit } from "@t3tools/shared/hqChanges";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsHistoryState } from "~/zerops/useRepositoryHistory";

import { ZeropsHistoryView } from "./ZeropsHistoryView";

const SHA = "3f9c1b2e".padEnd(40, "0");
const OTHER = "9c41d2e0".padEnd(40, "0");

const commit = (sha: string, subject: string, change: CompareCommit["change"]): CompareCommit => ({
  sha,
  subject,
  authorName: "ales",
  at: "2026-10-02T09:00:00.000Z",
  change,
});

const HISTORY: ZeropsHistoryState = {
  kind: "read",
  commits: [commit(SHA, "Fix the VAT table", null)],
  total: 1,
};

const render = (
  here: string | undefined,
  history: ZeropsHistoryState = HISTORY,
  onOpenChange?: () => void,
  tags: ReadonlyArray<string> = ["v0.1.13"],
) =>
  renderToStaticMarkup(
    <ZeropsHistoryView
      here={here}
      history={history}
      onOpenChange={onOpenChange}
      request={{ repo: "appdev", deployed: new Map([["stage", SHA]]) }}
      tags={new Map([[SHA, tags]])}
    />,
  );

describe("ZeropsHistoryView's release tag", () => {
  it("on a stop's Deploys, is the version in plain text beside a release role tag", () => {
    const markup = render("stage");
    const release =
      /data-zerops-surface="zerops-history-release"[^]*?<\/span><\/span><\/span>/.exec(markup)?.[0];
    expect(release).toContain(">v0.1.13<");
    expect(release).toContain(">release<");
    expect(release).not.toContain("zerops-status-ok-surface");
  });

  it("elsewhere, keeps the green release chip", () => {
    const markup = render(undefined);
    expect(markup).toContain("zerops-status-ok-surface");
    expect(markup).toContain(">v0.1.13<");
    expect(markup).not.toContain(">release<");
  });

  // A roll back brought the commit back: it names both releases that put it live.
  it("names every release that put the commit live, the first one first", () => {
    const markup = render(undefined, HISTORY, undefined, ["v0.1.0", "v0.1.2"]);
    expect(markup).toMatch(/>v0\.1\.0<[^]*>v0\.1\.2</u);
  });
});

describe("ZeropsHistoryView's rows", () => {
  const LANDED: ZeropsHistoryState = {
    kind: "read",
    commits: [
      commit(OTHER, "Two-step checkout", {
        number: 7,
        title: "Two-step checkout",
        mateProjectId: "p-wren",
      }),
      commit(SHA, "Fix the VAT table", null),
    ],
    total: 2,
  };

  it("opens the review of the change that landed a commit, and draws one none did as a line", () => {
    const markup = render(undefined, LANDED, () => {});
    expect(markup.match(/<button/gu)).toHaveLength(1);
    expect(markup).toMatch(/<button[^>]*>.*Two-step checkout/u);
  });

  it("says how many earlier commits HQ counted beyond the ones it listed", () => {
    expect(render(undefined, { ...LANDED, total: 347 })).toContain("345 earlier commits");
  });
});

it("a failed history offers Compare again beside its reason", () => {
  expect(
    render(undefined, { kind: "failed", reason: "HQ did not answer.", again: () => {} }),
  ).toContain("Compare again");
});
