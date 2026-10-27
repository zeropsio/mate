import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsAppFailed } from "./ZeropsAppFailed";

// A throw above the router took #root's content away and left the boot frame standing with no
// words; the app's own failure says what happened and offers the one way on.
describe("ZeropsAppFailed", () => {
  const markup = renderToStaticMarkup(<ZeropsAppFailed onReload={() => undefined} />);

  it("says the app could not open, in the landing shell", () => {
    expect(markup).toContain("<h1");
    expect(markup).toContain("Mate couldn&#x27;t open");
    expect(markup).toContain('data-zerops-app-failed="true"');
  });

  it("offers a reload as its one action", () => {
    expect(markup.match(/<button/gu)).toHaveLength(1);
    expect(markup).toContain("Reload");
  });
});
