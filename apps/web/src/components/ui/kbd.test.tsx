import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Kbd } from "./kbd";

describe("Kbd", () => {
  it("renders a glyph with keyboard semantics", () => {
    const key = "⌘K";
    const html = renderToStaticMarkup(<Kbd aria-label={`${key} key`}>{key}</Kbd>);

    expect(html.startsWith("<kbd")).toBe(true);
    expect(html).toContain('data-slot="kbd"');
    expect(html).toContain(`aria-label="${key} key"`);
  });
});
