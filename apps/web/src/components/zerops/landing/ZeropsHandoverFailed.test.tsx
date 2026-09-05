import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsHandoverFailed } from "./ZeropsHandoverFailed";

const noop = () => undefined;

describe("ZeropsHandoverFailed", () => {
  const markup = renderToStaticMarkup(
    <ZeropsHandoverFailed message="Sign-in was cancelled." onBack={noop} onRetry={noop} />,
  );

  it("stands in the landing shell: the mark, a title, the reason, one card", () => {
    expect(markup).toContain('data-mate-mark="live"');
    expect(markup).toContain("<h1");
    // Static markup escapes the apostrophe.
    expect(markup).toContain("Sign-in didn&#x27;t finish");
    expect(markup).toContain("Sign-in was cancelled.");
    expect(markup).toContain('data-zerops-handover-failed="true"');
    expect(markup).not.toContain("<header");
  });

  it("offers the retry as the one primary action and the way back as a line", () => {
    expect(markup.match(/<button/gu)).toHaveLength(2);
    expect(markup.indexOf("Try again")).toBeLessThan(markup.indexOf("Back to Zerops Mate"));
  });
});
