import { MATE_LOCKUP, MATE_MARK, MATE_WORDMARK } from "@t3tools/shared/brand";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MateLockup } from "./MateLockup";

describe("MateLockup", () => {
  const html = renderToStaticMarkup(<MateLockup className="h-6 w-auto" />);

  it("is the mark's own geometry beside the outlined wordmark, two boxes that meet", () => {
    expect(html).toContain(`viewBox="${MATE_MARK.viewBox}"`);
    expect(html).toContain(`viewBox="${MATE_LOCKUP.word.viewBox}"`);
    expect(html).not.toContain(`viewBox="${MATE_LOCKUP.viewBox}"`);
    for (const d of MATE_MARK.paths) expect(html).toContain(`d="${d}"`);
    for (const d of MATE_WORDMARK.paths) expect(html).toContain(`d="${d}"`);
    expect(html.match(/<rect /gu)).toHaveLength(2);
    expect(html).toContain('data-mate-lockup="still"');
  });

  it("keeps the loop teal and gives the eyes and letters the text colour", () => {
    expect(html).toContain(`fill="${MATE_MARK.color}"`);
    expect(html).toContain('fill="currentColor"');
    // No webfont: the word is paths, never text.
    expect(html).not.toContain("<text");
  });

  it("reads as the product by default and takes the caller's sizing", () => {
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Zerops Mate"');
    expect(html).toContain('class="mate-lockup h-6 w-auto"');
    // The parts are decoration inside the one named box.
    expect(html.match(/aria-hidden="true"/gu)).toHaveLength(2);
    expect(renderToStaticMarkup(<MateLockup label="Home" />)).toContain('aria-label="Home"');
  });

  it("steps out of the accessibility tree when its link already carries the name", () => {
    const decorative = renderToStaticMarkup(<MateLockup decorative />);
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain("role=");
    expect(decorative).not.toContain("aria-label");
  });

  it("hands the mark to the live one when asked, and keeps the word still beside it", () => {
    const live = renderToStaticMarkup(<MateLockup live />);
    expect(live).toContain('data-mate-lockup="live"');
    expect(live).toContain('data-mate-mark="live"');
    expect(live).toContain(`viewBox="${MATE_LOCKUP.word.viewBox}"`);
    for (const d of MATE_WORDMARK.paths) expect(live).toContain(`d="${d}"`);
    // The still lockup's own mark is not drawn a second time under the live one.
    expect(live).not.toContain('data-mate-lockup-part="mark"');
  });
});
