import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsMateCard, ZeropsMateVerb, ZeropsMateWord } from "./ZeropsMateCard";

function card(props: Partial<React.ComponentProps<typeof ZeropsMateCard>> = {}) {
  return renderToStaticMarkup(
    <ZeropsMateCard
      activity={<ZeropsMateWord label="Idle" tone="off" />}
      face="idle"
      name="Fen"
      tint="coral"
      {...props}
    />,
  );
}

describe("ZeropsMateCard", () => {
  it("is the face in its colour, the name, and one line about what the Mate is doing", () => {
    const html = card({
      activity: (
        <>
          <ZeropsMateWord className="text-sky-600" label="Working" pulse />
          <span>Reviewing the migration</span>
        </>
      ),
      face: "working",
    });
    expect(html).toContain('data-zerops-mate-card="still"');
    expect(html).toContain('data-mate-face-state="working"');
    expect(html).toContain('data-mate-face-tint="coral"');
    expect(html).toContain('data-mate-face-size="md"');
    expect(html).toContain(">Fen<");
    expect(html).toContain('data-zerops-surface="mate-activity"');
    expect(html).toContain(">Working<");
    expect(html).toContain("Reviewing the migration");
    expect(html.indexOf(">Fen<")).toBeLessThan(html.indexOf(">Working<"));
    // Nothing about the environment: no tag, no Zerops project name.
    expect(html).not.toContain("role-tag");
    expect(html).not.toContain("micro-label");
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

describe("the activity words", () => {
  it("takes a platform tone for a Mate whose socket is down", () => {
    const html = renderToStaticMarkup(<ZeropsMateWord label="Starting" tone="busy" />);
    expect(html).toContain("text-[var(--zerops-status-busy-text,var(--foreground))]");
    expect(html).toContain(">Starting<");
    // Read, not scanned: a word, not a label.
    expect(html).not.toContain("uppercase");
  });

  it("takes the thread status pill's own colour for a connected Mate, and pulses when told", () => {
    const html = renderToStaticMarkup(
      <ZeropsMateWord className="text-amber-600" label="Approval" pulse />,
    );
    expect(html).toContain("text-amber-600");
    expect(html).toContain("animate-status-pulse");
  });

  it("writes a verb in the acting colour", () => {
    const html = renderToStaticMarkup(<ZeropsMateVerb label="Connect" onClick={() => {}} />);
    expect(html).toContain("text-primary");
    expect(html).toContain('data-zerops-primary-action="Connect"');
  });
});
