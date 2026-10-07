import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { MateStatusMarker } from "./MateStatusMarker";

describe("the menu and conversation status marker", () => {
  it("shows a limit and named provider cause even without a reset", () => {
    const html = renderToStaticMarkup(
      <MateStatusMarker
        mateName="Rosa"
        status={{ kind: "limit", severity: "attention", provider: "Claude" }}
        timestampFormat="24-hour"
      />,
    );
    expect(html).toContain("Limit");
    expect(html).toContain("Rosa hit the Claude limit.");
    expect(html).not.toContain("until");
  });
  it("uses only the source reset time", () => {
    const html = renderToStaticMarkup(
      <MateStatusMarker
        status={{ kind: "limit", severity: "attention", until: "2026-10-07T16:00:00Z" }}
        timestampFormat="24-hour"
      />,
    );
    expect(html).toContain("until");
    expect(html).not.toContain("Back to work");
  });
  it.each([
    ["sign-in", "Sign in"],
    ["answer", "Needs an answer"],
    ["broken", "Needs attention"],
  ] as const)("shows the %s action clearly", (kind, label) => {
    expect(
      renderToStaticMarkup(
        <MateStatusMarker
          status={{ kind, severity: kind === "broken" ? "danger" : "attention" }}
          timestampFormat="24-hour"
        />,
      ),
    ).toContain(label);
  });
});
