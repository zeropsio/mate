import { TurnId } from "@t3tools/contracts";
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
  it("names the restarted Mate with human time instead of a generic failure", () => {
    const html = renderToStaticMarkup(
      <MateStatusMarker
        mateName="Eddy"
        timestampFormat="24-hour"
        status={{
          kind: "interrupted",
          severity: "attention",
          interruption: {
            turnId: TurnId.make("turn"),
            restart: { cause: "replaced", at: "2026-10-08T08:24:39.700Z" },
            continuation: "manual",
          },
        }}
      />,
    );
    expect(html).toContain("Eddy restarted at");
    expect(html).not.toContain("Needs attention");
    expect(html).not.toContain("2026-10-08T");
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

it("a restart with unknown occurrence time does not invent a clock", () => {
  const html = renderToStaticMarkup(
    <MateStatusMarker
      mateName="Eddy"
      timestampFormat="24-hour"
      status={{
        kind: "interrupted",
        severity: "attention",
        interruption: {
          turnId: TurnId.make("turn"),
          restart: { cause: "restarted", at: null },
          continuation: "manual",
        },
      }}
    />,
  );
  expect(html).toContain("Eddy restarted");
  expect(html).not.toContain("Eddy restarted at");
});
