import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Pill, StatusDisc } from "./ConversationPills";

/** The class list of every opening tag that carries `marker`, in document order. */
function classesOf(markup: string, marker: string): ReadonlyArray<ReadonlyArray<string>> {
  return [...markup.matchAll(/<[a-z][^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes(marker))
    .map((tag) => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(" "));
}

/**
 * Fills that all but vanish on one card or the other: `muted` sits 1.018
 * from the Zerops dark card, `secondary` close behind.
 */
const VANISHING_FILL = /^bg-(muted|secondary)(\/\d+)?$/;

describe("StatusDisc", () => {
  // Every disc shows on both cards; one with no state of its own takes a
  // share of the ink, never the muted surface.
  it.each([
    { tone: "busy", fill: "bg-status-busy-surface" },
    { tone: "ok", fill: "bg-status-ok-surface" },
    { tone: "failed", fill: "bg-status-failed-surface" },
    { tone: "attention", fill: "bg-status-attention-surface" },
    { tone: "idle", fill: "bg-foreground/8" },
  ] as const)("fills a $tone disc with $fill", ({ tone, fill }) => {
    const [disc = []] = classesOf(
      renderToStaticMarkup(<StatusDisc tone={tone}>·</StatusDisc>),
      "data-status-disc",
    );
    expect(disc).toContain(fill);
    expect(disc.some((name) => VANISHING_FILL.test(name))).toBe(false);
  });
});

describe("Pill", () => {
  const render = (toggles: boolean) =>
    renderToStaticMarkup(
      <Pill label="3 files changed" onToggle={toggles ? () => undefined : null}>
        3 files
      </Pill>,
    );

  // Its words are the size the live status bars say theirs in, on one line.
  it.each([
    { name: "a pill that tells", toggles: false },
    { name: "a pill that opens", toggles: true },
  ])("$name says its words at the status bars' size", ({ toggles }) => {
    const [pill = []] = classesOf(render(toggles), "data-pill");
    expect(pill).toContain("text-line");
    expect(pill).not.toContain("text-xs");
    expect(pill).toContain("h-7");
  });

  // One chevron in the conversation: the work line's size, ink and turn.
  it("opens with the work line's chevron", () => {
    const [chevron = []] = classesOf(render(true), "lucide-chevron");
    expect(chevron).toEqual(
      expect.arrayContaining([
        "size-3.5",
        "shrink-0",
        "opacity-70",
        "transition-transform",
        "duration-150",
      ]),
    );
    expect(chevron.some((name) => /^(size-3|opacity-60)$/.test(name))).toBe(false);
  });
});
