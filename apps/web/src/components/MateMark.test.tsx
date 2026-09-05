import { MATE_MARK, MATE_MARK_LIVE } from "@t3tools/shared/brand";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MateMark } from "./MateMark";

/**
 * Server rendering is also the pre-script paint, so what these assert is what
 * a reader sees before the driver's first frame — and what they keep seeing if
 * its script never runs.
 */
describe("MateMark", () => {
  it("renders the still mark open, with no band in the way", () => {
    const html = renderToStaticMarkup(<MateMark />);

    expect(html).toContain(`viewBox="${MATE_MARK.viewBox}"`);
    expect(html).toContain('data-mate-mark="still"');
    for (const d of MATE_MARK.paths) expect(html).toContain(d);
    // Eyes shown, band hidden: the still mark is the open face.
    expect(html).toContain('visibility="visible"');
    expect(html).not.toContain(MATE_MARK_LIVE.band.left);
  });

  it("renders the live mark closed, as the Zerops logo", () => {
    const html = renderToStaticMarkup(<MateMark playful />);

    expect(html).toContain('data-mate-mark="live"');
    // The band is present and at rest, and the eyes behind it are hidden.
    expect(html).toContain(MATE_MARK_LIVE.band.left);
    expect(html).toContain(MATE_MARK_LIVE.band.right);
    expect(html).toContain('visibility="hidden"');
  });

  it("keeps the extruded side wall invisible until the slab turns", () => {
    const html = renderToStaticMarkup(<MateMark playful />);
    expect(html).toContain('opacity="0"');
    // One <use> per extrusion layer, all referencing the one loop definition.
    expect(html.match(/<use /gu)?.length).toBeGreaterThan(1);
  });

  it("gives each instance its own ids, so two marks never share a clip path", () => {
    const html = renderToStaticMarkup(
      <div>
        <MateMark playful />
        <MateMark playful />
      </div>,
    );
    const clipIds = [...html.matchAll(/<clipPath id="([^"]+)"/gu)].map((match) => match[1]);
    expect(clipIds).toHaveLength(2);
    expect(new Set(clipIds).size).toBe(2);
  });

  it("is decorative: it carries no label and no status meaning", () => {
    const html = renderToStaticMarkup(<MateMark playful />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("aria-label");
    expect(html).not.toContain("role=");
  });
});
