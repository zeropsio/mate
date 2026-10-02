/**
 * A roll back that hasn't landed hands it to the person's own Mate, as a release's does (S6).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { RollbackReviewView } from "./ZeropsReleaseReview";

const NOW = Date.parse("2026-09-29T10:00:00Z");

const render = (fixer: string | undefined) =>
  renderToStaticMarkup(
    <RollbackReviewView
      fixer={fixer}
      line="app 5e1d0a7"
      live="v0.1.1"
      mayRelease
      name="Pantry"
      nextTag="v0.1.2"
      now={NOW}
      onClose={() => undefined}
      onFix={() => undefined}
      onRollBack={() => undefined}
      outcome={{ kind: "stalled", at: undefined, sinceMs: NOW - 31 * 60_000 }}
      press={{ kind: "done" }}
      services={["app"]}
      tag="v0.1.0"
      where={[{ service: "app", line: "goes back to 5e1d0a7" }]}
    />,
  );

/** The visible text, tags stripped, whitespace folded. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();

describe("a roll back that hasn't landed", () => {
  it("says so, and offers the person's Mate to find out why", () => {
    const text = textOf(render("Juno"));
    expect(text).toContain("v0.1.2 hasn't landed");
    expect(text).toContain("Ask Juno to find out why");
  });

  it("offers no Mate when the person has none", () => {
    expect(textOf(render(undefined))).not.toContain("Ask ");
  });
});
