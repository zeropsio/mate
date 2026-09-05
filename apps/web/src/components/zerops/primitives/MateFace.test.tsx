import { MATE_FACE, MATE_TINT_IDS, mateFaceParts } from "@t3tools/shared/brand";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MateFace } from "./MateFace";

describe("MateFace", () => {
  it.each(MATE_TINT_IDS)("draws the %s disc from its palette token", (tint) => {
    const html = renderToStaticMarkup(<MateFace state="idle" tint={tint} />);
    expect(html).toContain(`data-mate-face-tint="${tint}"`);
    expect(html).toContain(`fill-[var(--zerops-mate-tint-${tint})]`);
    expect(html).toContain(`r="${MATE_FACE.radius}"`);
    // The eyes are ink from the palette, never a literal.
    expect(html).toContain("fill-[var(--zerops-mate-face-ink)]");
    expect(html).not.toMatch(/#[0-9a-f]{6}/iu);
  });

  it("is decorative: the name and the word beside it carry the meaning", () => {
    const html = renderToStaticMarkup(<MateFace state="idle" tint="coral" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("aria-label");
    expect(html).toContain('data-zerops-primitive="mate-face"');
  });

  it("wears open pills when idle, and the same pills narrowed when working", () => {
    const idle = renderToStaticMarkup(<MateFace state="idle" tint="sky" />);
    const working = renderToStaticMarkup(<MateFace state="working" tint="sky" />);
    expect(idle.match(/<rect /gu)).toHaveLength(2);
    expect(working.match(/<rect /gu)).toHaveLength(2);
    const [eye] = mateFaceParts("working").eyes;
    expect(working).toContain(`height="${eye!.height}"`);
    expect(idle).not.toContain('<circle cx="50" cy="' + MATE_FACE.mouth.y);
  });

  it("opens an o when it needs you", () => {
    const html = renderToStaticMarkup(<MateFace state="needs" tint="amber" />);
    expect(html).toContain(`cy="${MATE_FACE.mouth.y}"`);
    expect(html).toContain(`r="${MATE_FACE.mouth.r}"`);
    expect(html).toContain('data-mate-face-state="needs"');
  });

  it("smiles with two arcs and no pills when done", () => {
    const html = renderToStaticMarkup(<MateFace state="done" tint="olive" />);
    expect(html).not.toContain("<rect ");
    expect(html.match(/<path /gu)).toHaveLength(3);
  });

  it("shuts its eyes as hairlines that survive a 14 px disc", () => {
    const html = renderToStaticMarkup(<MateFace size="dot" state="sleep" tint="rose" />);
    expect(html).not.toContain("<rect ");
    expect(html.match(/<line /gu)).toHaveLength(2);
    expect(html).toContain('vector-effect="non-scaling-stroke"');
    expect(html).toContain('stroke-width="1.25"');
    expect(html).toContain("size-3.5");
  });

  it("sizes as a dot, beside text, or as a card's avatar", () => {
    expect(renderToStaticMarkup(<MateFace size="dot" state="idle" tint="sand" />)).toContain(
      'data-mate-face-size="dot"',
    );
    expect(renderToStaticMarkup(<MateFace size="sm" state="idle" tint="sand" />)).toContain(
      "size-5",
    );
    expect(renderToStaticMarkup(<MateFace state="idle" tint="sand" />)).toContain("size-9");
  });
});
