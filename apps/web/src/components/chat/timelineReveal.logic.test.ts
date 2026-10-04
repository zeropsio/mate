import { describe, expect, it } from "vite-plus/test";

import { REVEAL_MARGIN_PX, revealBy } from "./timelineReveal.logic";

// The view: 0 at its top, 700 where the composer starts covering it.
const view = { top: 0, bottom: 700 };

describe("revealBy", () => {
  it.each([
    { what: "opened well inside the view", opener: 200, bottom: 500, by: 0 },
    { what: "its foot just inside the margin", opener: 200, bottom: 700 - REVEAL_MARGIN_PX, by: 0 },
    {
      what: "opened under the composer",
      opener: 500,
      bottom: 900,
      by: 900 - (700 - REVEAL_MARGIN_PX),
    },
    // Taller than the view: its opener stays in view, near the top.
    { what: "taller than the view", opener: 500, bottom: 2000, by: 500 - REVEAL_MARGIN_PX },
    { what: "its opener already near the top", opener: 10, bottom: 2000, by: 0 },
  ])("brings what the person opened into view, $what: by $by", ({ opener, bottom, by }) => {
    expect(revealBy({ openerTop: opener, regionBottom: bottom, view })).toBe(by);
  });
});
