import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsMateCard, ZeropsMateVerb } from "./ZeropsMateCard";

function card(props: Partial<React.ComponentProps<typeof ZeropsMateCard>> = {}) {
  return renderToStaticMarkup(<ZeropsMateCard face="idle" name="Fen" tint="coral" {...props} />);
}

describe("ZeropsMateCard", () => {
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
    expect(html).toContain("min-h-[3.75rem]");
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

  it("says when it is busy", () => {
    expect(card({ busy: true })).toContain('aria-busy="true"');
    expect(card()).not.toContain("aria-busy");
  });
});

describe("ZeropsMateVerb", () => {
  it("writes a verb in the acting colour", () => {
    const html = renderToStaticMarkup(<ZeropsMateVerb label="Connect" onClick={() => {}} />);
    expect(html).toContain("text-primary");
    expect(html).toContain('data-zerops-primary-action="Connect"');
  });
});
