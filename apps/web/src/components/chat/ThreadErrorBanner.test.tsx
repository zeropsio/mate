// @vitest-environment happy-dom
import { agentAdmission, admissionExplainsRefusal } from "@t3tools/client-runtime/data";
import { ProviderInstanceId, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import { AgentAdmissionExplanation } from "./AgentAdmissionExplanation";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ThreadErrorBanner } from "./ThreadErrorBanner";

const SIGNED_OUT =
  "Claude could not authenticate. For subscription login, run `claude auth login` on this environment's machine, then start a new thread. For API-key authentication, check this instance's configured credentials.";

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: true,
  version: "1",
  status: "error",
  auth: { status: "unauthenticated" },
  checkedAt: "2026-10-08T00:00:00Z",
  models: [],
  skills: [],
  slashCommands: [],
};
const snapshot = {
  available: true,
  agents: [
    {
      agentId: "claude-code",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unauthenticated",
      state: "not-authorized",
    },
  ],
} as const;
const attention = agentAdmission({
  environmentId: "rig",
  instanceId: provider.instanceId,
  viewerSubject: "owner",
  read: {
    state: "known",
    value: snapshot,
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "live" },
  },
  providers: [provider],
  mateName: "Rosa",
}).attention;

describe("the thread's error banner", () => {
  it("tells a legacy limit calmly, without asking for a message to be retyped", () => {
    const error = "Claude usage limit reached. Send the message again once the limit resets.";
    const html = renderToStaticMarkup(<ThreadErrorBanner mateName="Rosa" error={error} />);
    expect(html).toContain("Rosa hit the Claude limit.");
    expect(html).not.toContain("Send the message again");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<svg");
    expect(
      renderToStaticMarkup(<ThreadErrorBanner mateName="Rosa" error={error} usageLimitShown />),
    ).toBe("");
  });
  it("offers to sign the agent in rather than repeat a command nobody here can run", () => {
    const html = renderToStaticMarkup(
      <AgentAdmissionExplanation attention={attention} onAction={() => {}} />,
    );
    expect(html).toContain('data-zerops-primary-action="Authorize"');
    expect(html).toContain("Rosa needs a Claude sign-in to continue.");
    // The machine the driver names is a container the person has no shell on.
    expect(html).not.toContain("claude auth login");
    expect(html).not.toContain("<svg");
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
  ])("says the Mate is signed out where its sign-in was $case", () => {
    expect(
      admissionExplainsRefusal(attention, { loginId: "claude-code", reason: "missing-sign-in" }),
    ).toBe(true);
    const html = renderToStaticMarkup(
      <AgentAdmissionExplanation attention={attention} onAction={() => {}} />,
    );
    expect(html).toContain("Rosa needs a Claude sign-in to continue.");
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
      <ThreadErrorBanner mateName="Rosa" driver={driver} error={error} />,
    );
    expect(html).not.toContain('data-zerops-primary-action="Authorize"');
    expect(html).not.toContain("signed out");
  });

  it("keeps a sign-in refusal as history without claiming current admission", () => {
    const html = renderToStaticMarkup(<ThreadErrorBanner mateName="Rosa" error={SIGNED_OUT} />);
    expect(html).not.toContain('data-zerops-primary-action="Authorize"');
    expect(html).toContain("Rosa&#x27;s turn could not continue because Claude was signed out.");
    expect(html).not.toContain("claude auth login");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<svg");
  });

  it("leaves every other failure exactly as it came back", () => {
    const html = renderToStaticMarkup(
      <ThreadErrorBanner mateName="Rosa" error="The container is not reachable." />,
    );
    expect(html).toContain("The container is not reachable.");
    expect(html).not.toContain('data-zerops-primary-action="Authorize"');
  });

  it("says nothing when nothing failed", () => {
    expect(renderToStaticMarkup(<ThreadErrorBanner mateName="Rosa" error={null} />)).toBe("");
  });
});

it("the sign-in button opens the available sign-in action", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const signIn = vi.fn();
  try {
    await act(() =>
      root.render(<AgentAdmissionExplanation attention={attention} onAction={signIn} />),
    );
    const button = Array.from(host.querySelectorAll("button")).find(
      (item) => item.textContent === "Sign in",
    );
    if (button === undefined) throw new Error("The notice has no sign-in action.");
    await act(() => button.click());
    expect(signIn).toHaveBeenCalledOnce();
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
