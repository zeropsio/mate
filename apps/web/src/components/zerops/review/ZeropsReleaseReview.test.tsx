/**
 * What a release's review says before the press: what goes out, and — where what production runs
 * on a service cannot be told — that it cannot, beside what does go out.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ReleaseReviewView, type ReleaseReviewViewProps } from "./ZeropsReleaseReview";

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
