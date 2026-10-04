import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { StopPublicAccessLinks, StopPublicAccessStatus } from "./StopPublicAccess";

describe("a stop's public access knowledge", () => {
  it.each([
    { state: "unread", waitingFor: null } as const,
    { state: "reading", sinceMs: 1, attempt: 1 } as const,
  ])("an $state address list says reading, never no addresses", (shown) => {
    const html = renderToStaticMarkup(<StopPublicAccessStatus shown={shown} again={() => {}} />);
    expect(html).toContain("Reading public addresses");
    expect(html).not.toContain("None yet");
  });
  it("a failed address list names the failure and offers Again", () => {
    const html = renderToStaticMarkup(
      <StopPublicAccessStatus
        shown={{
          state: "failed",
          failure: { kind: "transport", detail: "Zerops did not answer" },
          atMs: 1,
          attempt: 1,
          retryAtMs: null,
        }}
        again={() => {}}
      />,
    );
    expect(html).toContain("Could not read public addresses");
    expect(html).toContain("Again");
    expect(html).not.toContain("None yet");
  });
});

it("runtime-only stops show their public links even before HQ detail answers", () => {
  const html = renderToStaticMarkup(
    <StopPublicAccessLinks
      shown={{
        state: "known",
        value: {
          routes: [
            { service: "web", port: 80, url: "https://web.example.test", host: "web.example.test" },
          ],
          offers: [],
        },
        asOf: { ordinal: 1, atMs: 1 },
        coverage: "complete",
        freshness: { kind: "settled" },
      }}
      again={() => {}}
    />,
  );
  expect(html).toContain('href="https://web.example.test"');
  expect(html).toContain("web.example.test");
});
