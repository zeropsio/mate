import { MATE_LOCKUP, MATE_MARK, MATE_WORDMARK } from "@t3tools/shared/brand";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MateLockup } from "./MateLockup";

describe("MateLockup", () => {
  const html = renderToStaticMarkup(<MateLockup className="h-6 w-auto" />);

  it("is the mark's own geometry beside the outlined wordmark, in one box", () => {
    expect(html).toContain(`viewBox="${MATE_LOCKUP.viewBox}"`);
    for (const d of MATE_MARK.paths) expect(html).toContain(`d="${d}"`);
    for (const d of MATE_WORDMARK.paths) expect(html).toContain(`d="${d}"`);
    expect(html.match(/<rect /gu)).toHaveLength(2);
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
    expect(renderToStaticMarkup(<MateLockup label="Home" />)).toContain('aria-label="Home"');
  });

  it("steps out of the accessibility tree when its link already carries the name", () => {
    const decorative = renderToStaticMarkup(<MateLockup decorative />);
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain("role=");
    expect(decorative).not.toContain("aria-label");
  });
});
