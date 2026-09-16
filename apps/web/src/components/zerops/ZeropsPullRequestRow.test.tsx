import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsPullRequestRow } from "./ZeropsPullRequestRow";

function row(props: Partial<React.ComponentProps<typeof ZeropsPullRequestRow>> = {}) {
  return renderToStaticMarkup(
    <ZeropsPullRequestRow line="#12 · ada" title="Add a worker to the stage tier" {...props} />,
  );
}

describe("ZeropsPullRequestRow", () => {
  it("reads down the same three columns as an environment's row", () => {
    const html = row();
    expect(html).toContain('data-zerops-pull-request-row="true"');
    expect(html).toContain("sm:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_auto]");
    expect(html).toContain("Add a worker to the stage tier");
    expect(html).toContain("#12 · ada");
    expect(html.indexOf("Add a worker to the stage tier")).toBeLessThan(html.indexOf("#12 · ada"));
  });

  it("says what kind of change it is, once, as a tag", () => {
    const html = row();
    expect(html).toContain('data-zerops-surface="role-tag"');
    expect(html).toContain(">recipe<");
    // The state is the line's and the caller's; the row invents no word.
    expect(html).not.toContain("Open");
    expect(html).not.toContain("status-dot");
  });

  it("carries the caller's one verb, and nothing when there is none", () => {
    expect(row({ action: <button type="button">Review</button> })).toContain("Review");
    expect(row()).not.toContain("<button");
  });
});
