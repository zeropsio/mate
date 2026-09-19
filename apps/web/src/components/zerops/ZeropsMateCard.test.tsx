import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsMateCard, ZeropsMateVerb, ZeropsToolCard } from "./ZeropsMateCard";

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
});

describe("ZeropsToolCard", () => {
  it("is the Mate card's treatment for a tool: the same surface, the name, one line and a menu", () => {
    const html = renderToStaticMarkup(
      <ZeropsToolCard
        line={<span>Setting up.</span>}
        menu={<span data-test="menu" />}
        name="Gitea"
      />,
    );
    expect(html).toContain('data-zerops-tool-card="true"');
    expect(html).toContain(">Gitea<");
    expect(html).toContain("Setting up.");
    expect(html).toContain('data-test="menu"');
    // Same card: the radius, the surface, the padding and the reserved height.
    for (const token of [
      "rounded-[var(--zerops-card-radius)]",
      "bg-card",
      "min-h-[4.5rem]",
      "ps-3 pe-2",
    ]) {
      expect(html).toContain(token);
    }
    // No face: a tool is nobody. No status word, no hover, not a way in.
    expect(html).not.toContain("mate-face");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("hover:border-border");
  });

  it("lets the name sit alone while there is nothing to say", () => {
    const html = renderToStaticMarkup(<ZeropsToolCard name="Gitea" />);
    expect(html).toContain(">Gitea<");
    expect(html).not.toContain("tool-line");
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
    expect(html).toContain("active:scale-[0.97]");
  });
});
