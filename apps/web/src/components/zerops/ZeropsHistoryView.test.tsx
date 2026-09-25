import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCommitsState } from "~/zerops/useZeropsRepositoryCommits";

import { ZeropsHistoryView } from "./ZeropsHistoryView";

const SHA = "3f9c1b2e".padEnd(40, "0");

const COMMITS: ZeropsCommitsState = {
  kind: "read",
  commits: [{ sha: SHA, subject: "Fix the VAT table", author: "ales", at: undefined }],
  releases: new Map([[SHA, "v0.1.13"]]),
};

const render = (here: string | undefined) =>
  renderToStaticMarkup(
    <ZeropsHistoryView
      commits={COMMITS}
      here={here}
      request={{ repo: "appdev", deployed: new Map([["stage", SHA]]) }}
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
});
