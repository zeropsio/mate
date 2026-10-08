import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerStashBadge } from "./ComposerStashBadge";

describe("ComposerStashBadge", () => {
  it("renders as an attached composer tab instead of a floating pill", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashBadge
        count={3}
        menuOpen={false}
        pulseKey={0}
        pulsing={false}
        onToggleMenu={() => {}}
      />,
    );

    expect(markup).toContain('aria-expanded="false"');
  });

  it("reports when the stash drawer is open", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashBadge
        count={3}
        menuOpen
        pulseKey={0}
        pulsing={false}
        onToggleMenu={() => {}}
      />,
    );

    expect(markup).toContain('aria-expanded="true"');
  });

  it("keeps a compact inline entry point when a drawer occupies the tab", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashBadge
        count={3}
        menuOpen
        placement="inline"
        pulseKey={0}
        pulsing={false}
        onToggleMenu={() => {}}
      />,
    );

    expect(markup).toContain('data-slot="button"');

    expect(markup).toContain("Stashed prompts: 3. Open stash.");
    expect(markup).toContain('aria-expanded="true"');
  });
});
