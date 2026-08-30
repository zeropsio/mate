import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { KeyChip } from "./KeyChip";

describe("KeyChip", () => {
  it("renders a glyph with keyboard semantics", () => {
    const key = "⌘K";
    const html = renderToStaticMarkup(<KeyChip aria-label={`${key} key`}>{key}</KeyChip>);

    expect(html.startsWith("<kbd")).toBe(true);
    expect(html).toContain('data-zerops-primitive="key-chip"');
    expect(html).toContain(`aria-label="${key} key"`);
    expect(html).toContain("rounded-[var(--zerops-key-chip-radius)]");
  });
});
