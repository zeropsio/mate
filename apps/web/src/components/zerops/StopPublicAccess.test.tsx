import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { StopPublicAccessLinks, StopPublicAccessStatus } from "./StopPublicAccess";

describe("a stop's public access knowledge", () => {
  it("an address list being read says reading, never no addresses", () => {
    const html = renderToStaticMarkup(
      <StopPublicAccessStatus
        shown={{ state: "reading", denied: false, routes: [], offers: [] }}
        again={() => {}}
      />,
    );
    expect(html).toContain("Reading public addresses");
    expect(html).not.toContain("None yet");
  });
  it("a failed address list names the failure and offers Again", () => {
    const html = renderToStaticMarkup(
      <StopPublicAccessStatus
        shown={{ state: "failed", denied: false, routes: [], offers: [] }}
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
        state: "ready",
        denied: false,
        routes: [
          { service: "web", port: 80, url: "https://web.example.test", host: "web.example.test" },
        ],
        offers: [],
      }}
      again={() => {}}
    />,
  );
  expect(html).toContain('href="https://web.example.test"');
  expect(html).toContain("web.example.test");
});
