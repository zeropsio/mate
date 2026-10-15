import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Card } from "./card";

describe("FlatCard", () => {
  it("contains accessible consumer content", () => {
    const label = "Service";
    const html = renderToStaticMarkup(
      <Card aria-label={label} variant="flat">
        {label}
      </Card>,
    );

    expect(html.startsWith("<div")).toBe(true);
    expect(html).toContain('data-slot="card"');
    expect(html).toContain(`aria-label="${label}"`);
  });
});
