import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsMateCard, ZeropsMateVerb } from "./ZeropsMateCard";

function card(props: Partial<React.ComponentProps<typeof ZeropsMateCard>> = {}) {
  return renderToStaticMarkup(<ZeropsMateCard face="idle" name="Fen" tint="coral" {...props} />);
}

describe("ZeropsMateCard", () => {
  it("shows the update line the caller hands it, and nothing when there is none", () => {
    expect(card({ updateLine: <span>Server 0.6.0</span> })).toContain("Server 0.6.0");
    expect(card()).not.toContain("Server ");
  });
  it("is the face in its colour wearing the state, the name, and the line about what the Mate is on", () => {
    const html = card({ face: "working", line: <span>Reviewing the migration</span> });
    expect(html).toContain('data-zerops-mate-card="still"');
    expect(html).toContain('data-mate-face-state="working"');
    expect(html).toContain('data-mate-face-tint="coral"');
    expect(html).toContain('data-mate-face-size="md"');
    expect(html).toContain(">Fen<");
    expect(html).toContain('data-zerops-surface="mate-line"');
    expect(html).toContain("Reviewing the migration");
    expect(html.indexOf(">Fen<")).toBeLessThan(html.indexOf("Reviewing the migration"));
    // The state is the face's: no status word, no label of any kind, nothing
    // about the environment — no tag, no Zerops project name.
    expect(html).not.toContain("Working");
    expect(html).not.toContain("Idle");
    expect(html).not.toContain("role-tag");
    expect(html).not.toContain("micro-label");
  });

  it("lets the name sit alone for a Mate with nothing to say yet, at the card's full height", () => {
    const html = card();
    expect(html).not.toContain("mate-line");
    // The height a name, a line and a snippet need, reserved whether or not
    // the conversation has answered: a card that grew on the socket's answer
    // would push every card below it down the page.
    expect(html).toContain("min-h-[4.5rem]");
  });

  it("dates the Mate at the name's edge and quotes its last words under the line", () => {
    const html = card({
      line: <span>Reviewing the migration</span>,
      snippet: "Done — the column is nullable now",
      time: "2h",
    });
    expect(html).toContain('data-zerops-surface="mate-time"');
    expect(html).toContain(">2h<");
    expect(html).toContain('data-zerops-surface="mate-snippet"');
    expect(html.indexOf("Reviewing the migration")).toBeLessThan(
      html.indexOf("Done — the column is nullable now"),
    );
  });

  it("says nothing where there is no time and no last word", () => {
    const html = card({ snippet: undefined, time: undefined });
    expect(html).not.toContain("mate-time");
    expect(html).not.toContain("mate-snippet");
  });

  it("is the way in when it can be: the name is the button and stretches over the card", () => {
    const opens = card({ onSelect: () => {} });
    expect(opens).toContain('data-zerops-mate-card="opens"');
    expect(opens).toContain('data-zerops-surface="mate-open"');
    expect(opens).toContain("after:absolute after:inset-0");
    expect(opens).toContain("hover:border-border");
    // Still: no button, no hover.
    const still = card();
    expect(still).not.toContain("<button");
    expect(still).not.toContain("hover:border-border");
  });

  it("shows its menu on hover, above the way in", () => {
    const html = card({ menu: <span data-test="menu" />, onSelect: () => {} });
    expect(html).toContain('data-test="menu"');
    expect(html).toContain("group-hover/card:opacity-100");
    expect(html).toContain("z-[1]");
  });

  it("shows a trailing action always, not only on hover", () => {
    const html = card({ action: <button type="button">Start</button> });
    expect(html).toContain('data-zerops-surface="mate-action"');
    expect(html).toContain(">Start<");
    const actionSpan = html.slice(
      html.indexOf('data-zerops-surface="mate-action"') - 200,
      html.indexOf('data-zerops-surface="mate-action"'),
    );
    expect(actionSpan).not.toContain("opacity-0");
  });

  it("says when it is busy", () => {
    expect(card({ busy: true })).toContain('aria-busy="true"');
    expect(card()).not.toContain("aria-busy");
  });

  it("lies flat in a row: no surface, its Preview on the name's line, no quoted last words", () => {
    const html = card({
      layout: "row",
      line: <span>Reviewing the migration</span>,
      onSelect: () => {},
      preview: "https://app.example/",
      snippet: "Done — the column is nullable now",
      time: "2h",
    });
    const open = html.slice(0, html.indexOf(">"));
    expect(open).toContain('data-zerops-mate-card="opens"');
    expect(open).not.toContain("bg-card");
    expect(open).not.toContain("border-border/60");
    expect(open).not.toContain("min-h-");
    expect(open).toContain("hover:bg-accent/60");
    expect(html).toContain('data-mate-face-size="md"');
    // Line 1 is the name, its time, then the Preview; line 2 the line.
    const name = html.indexOf(">Fen<");
    const time = html.indexOf(">2h<");
    const preview = html.indexOf('data-zerops-surface="mate-preview"');
    const line = html.indexOf('data-zerops-surface="mate-line"');
    expect(name).toBeLessThan(time);
    expect(time).toBeLessThan(preview);
    expect(preview).toBeLessThan(line);
    expect(html).toContain('href="https://app.example/"');
    expect(html).not.toContain("mate-snippet");
  });

  it("keeps a row's name whole where its line is short: the time and Preview wrap, the name never gives way", () => {
    const html = card({
      layout: "row",
      onSelect: () => {},
      preview: "https://app.example/",
      time: "3h ago",
    });
    const lineOne = html.slice(html.lastIndexOf("<div", html.indexOf(">Fen<")));
    expect(lineOne).toMatch(/^<div class="[^"]*flex-wrap/u);
    const button = html.slice(html.lastIndexOf("<button", html.indexOf(">Fen<")));
    expect(button).toMatch(/^<button class="[^"]*flex-none/u);
  });

  it.each([
    ["with a Preview", "https://app.example/"],
    ["without one", undefined],
  ] as const)("carries a row's time right after its name, %s", (_name, preview) => {
    const html = card({ layout: "row", onSelect: () => {}, preview, time: "4h ago" });
    const at = html.indexOf('data-zerops-surface="mate-time"');
    const time = html.slice(html.lastIndexOf("<span", at), at);
    expect(time).not.toContain("ms-auto");
  });

  it("lets a row's line 2 run the row's width: its menu sits on the name's line", () => {
    const html = card({
      layout: "row",
      line: <span>vyvor dashboard s pocasim</span>,
      menu: <span data-test="menu" />,
      onSelect: () => {},
    });
    const menu = html.indexOf('data-test="menu"');
    expect(menu).toBeGreaterThan(html.indexOf(">Fen<"));
    expect(menu).toBeLessThan(html.indexOf('data-zerops-surface="mate-line"'));
    expect(html.slice(0, html.indexOf(">"))).not.toContain("w-full");
  });

  it("draws no Preview as a card, and none in a row without one", () => {
    expect(card({ preview: "https://app.example/" })).not.toContain("mate-preview");
    expect(card({ layout: "row" })).not.toContain("mate-preview");
  });
});

describe("ZeropsMateVerb", () => {
  it("draws a verb as a control, never as a link out", () => {
    // Blue underlined text meant "this leaves for Gitea" until nothing did;
    // a verb that still read that way was lying about where it goes.
    const html = renderToStaticMarkup(<ZeropsMateVerb label="Connect" onClick={() => {}} />);
    expect(html).toContain("border-input");
    expect(html).not.toContain("hover:underline");
    expect(html).toContain('data-zerops-primary-action="Connect"');
  });

  it("answers a press, so the row feels heard", () => {
    const html = renderToStaticMarkup(<ZeropsMateVerb label="Merge" onClick={() => {}} />);
    expect(html).toContain("active:scale-95");
  });
});
