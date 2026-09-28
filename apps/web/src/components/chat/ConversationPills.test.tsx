import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Pill } from "./ConversationPills";

/** The class list of every opening tag that carries `marker`, in document order. */
function classesOf(markup: string, marker: string): ReadonlyArray<ReadonlyArray<string>> {
  return [...markup.matchAll(/<[a-z][^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes(marker))
    .map((tag) => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(" "));
}

describe("Pill", () => {
  const render = (opens: boolean) =>
    renderToStaticMarkup(
      <Pill label="3 files changed" onClick={opens ? () => undefined : null}>
        3 files
      </Pill>,
    );

  // Its words are the size the live status bars say theirs in, on one line.
  it.each([
    { name: "a pill that tells", opens: false },
    { name: "a pill that opens", opens: true },
  ])("$name says its words at the status bars' size", ({ opens }) => {
    const [pill = []] = classesOf(render(opens), "data-pill");
    expect(pill).toContain("text-line");
    expect(pill).not.toContain("text-xs");
    expect(pill).toContain("h-7");
  });

  // Nothing about a run opens in place: a pill that opens goes somewhere —
  // a dialog, the diff — and no chevron says it unfolds.
  it("opens somewhere, never in place", () => {
    const markup = render(true);
    expect(markup).toContain("<button");
    expect(markup).not.toContain("aria-expanded");
    expect(markup).not.toContain("lucide-chevron");
  });
});
