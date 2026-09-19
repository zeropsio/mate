import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ThreadErrorBanner } from "./ThreadErrorBanner";

const SIGNED_OUT =
  "Claude could not authenticate. For subscription login, run `claude auth login` on this environment's machine, then start a new thread. For API-key authentication, check this instance's configured credentials.";

describe("the thread's error banner", () => {
  it("offers to sign the agent in rather than repeat a command nobody here can run", () => {
    const html = renderToStaticMarkup(
      <ThreadErrorBanner error={SIGNED_OUT} onAuthorize={() => {}} />,
    );
    expect(html).toContain('data-zerops-primary-action="Authorize"');
    expect(html).toContain("This agent is not signed in yet");
    // The machine the driver names is a container the person has no shell on.
    expect(html).not.toContain("claude auth login");
  });

  it("keeps the driver's own words where there is nowhere to sign in", () => {
    const html = renderToStaticMarkup(<ThreadErrorBanner error={SIGNED_OUT} />);
    expect(html).not.toContain('data-zerops-primary-action="Authorize"');
    expect(html).toContain("claude auth login");
  });

  it("leaves every other failure exactly as it came back", () => {
    const html = renderToStaticMarkup(
      <ThreadErrorBanner error="The container is not reachable." onAuthorize={() => {}} />,
    );
    expect(html).toContain("The container is not reachable.");
    expect(html).not.toContain('data-zerops-primary-action="Authorize"');
  });

  it("says nothing when nothing failed", () => {
    expect(renderToStaticMarkup(<ThreadErrorBanner error={null} />)).toBe("");
  });
});
