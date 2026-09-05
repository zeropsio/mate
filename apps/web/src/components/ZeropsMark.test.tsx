import { renderToStaticMarkup } from "react-dom/server";
import { ZEROPS_MARK } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsMark } from "./ZeropsMark";

describe("ZeropsMark", () => {
  it("renders the shared two-tone brand mark as decorative artwork", () => {
    const markup = renderToStaticMarkup(<ZeropsMark className="mark" />);

    expect(markup).toContain(`viewBox="${ZEROPS_MARK.viewBox}"`);
    expect(markup).toContain(`aria-hidden="true"`);
    expect(markup).toContain(`class="mark"`);
    expect(markup.match(/<path/gu)).toHaveLength(ZEROPS_MARK.paths.length);
    for (const path of ZEROPS_MARK.paths) {
      expect(markup).toContain(`d="${path.d}"`);
      expect(markup).toContain(`fill="${path.fill}"`);
    }
  });

  it("takes the text colour when told to, for a place that already has one", () => {
    const markup = renderToStaticMarkup(<ZeropsMark tone="current" />);

    expect(markup).toContain('data-zerops-mark-tone="current"');
    expect(markup.match(/fill="currentColor"/gu)).toHaveLength(ZEROPS_MARK.paths.length);
    for (const path of ZEROPS_MARK.paths) {
      expect(markup).not.toContain(`fill="${path.fill}"`);
    }
  });
});
