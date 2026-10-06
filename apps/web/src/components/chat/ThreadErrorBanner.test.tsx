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

  // F7: the Mate is the subject, the agent only what the person signs in to — for a sign-in the
  // driver refused and for a stream that died signed out alike.
  it.each([
    { case: "refused", error: SIGNED_OUT },
    {
      case: "expired mid-run",
      error:
        "Claude's sign-in has expired. Sign Claude in again, then send a message to pick up where it left off.",
    },
  ])("says the Mate is signed out where its sign-in was $case", ({ error }) => {
    const html = renderToStaticMarkup(
      <ThreadErrorBanner error={error} mate="Sage" onAuthorize={() => {}} />,
    );
    expect(html).toContain("Sage is signed out of Claude. Sign in again to continue.");
    expect(html).toContain('data-zerops-primary-action="Authorize"');
  });

  // Pass 43's review: Git saying it "could not authenticate" is no agent signed out.
  it.each([
    {
      case: "Git refused by its remote",
      error: "Git could not authenticate with the remote.",
      driver: null,
    },
    { case: "Claude's words in another driver's conversation", error: SIGNED_OUT, driver: "codex" },
  ])("leaves $case as it came, with nothing to authorize", ({ error, driver }) => {
    const html = renderToStaticMarkup(
      <ThreadErrorBanner driver={driver} error={error} mate="Sage" onAuthorize={() => {}} />,
    );
    expect(html).not.toContain('data-zerops-primary-action="Authorize"');
    expect(html).not.toContain("signed out");
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
