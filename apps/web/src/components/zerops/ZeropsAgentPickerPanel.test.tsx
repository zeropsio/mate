import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsAgentPickerPanel } from "./ZeropsAgentPickerPanel";

const noop = () => {};

describe("ZeropsAgentPickerPanel", () => {
  it("renders a needs-sign-in agent with its sign-in button", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentPickerPanel
        agentId="claude-code"
        availability={{ kind: "needs-sign-in", signInKind: "not-authorized" }}
        onCancel={noop}
        onOpenDialog={noop}
        requestClosePicker={noop}
      />,
    );

    expect(html).toContain("Claude Code");
    expect(html).toContain("Not signed in.");
    expect(html).toContain("Sign in to Claude");
    expect(html).toContain('data-zerops-agent-availability="needs-sign-in"');
    expect(html).not.toContain("Cancel");
  });

  it("renders an agent whose sign-in is still being read as checking, with no button", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentPickerPanel
        agentId="claude-code"
        availability={{ kind: "unknown", read: { state: "unread", waitingFor: null } }}
        onCancel={noop}
        onOpenDialog={noop}
        requestClosePicker={noop}
      />,
    );

    expect(html).toContain("Checking whether Claude Code is signed in…");
    expect(html).toContain('data-zerops-agent-availability="unknown"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Not signed in.");
  });

  it("renders a signing-in agent with continue and cancel", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentPickerPanel
        agentId="codex"
        availability={{ kind: "signing-in" }}
        onCancel={noop}
        onOpenDialog={noop}
        requestClosePicker={noop}
      />,
    );

    expect(html).toContain("Continue authorization");
    expect(html).toContain("Cancel");
  });

  it("renders someone-else with the recorded signer's name", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentPickerPanel
        agentId="claude-code"
        availability={{ kind: "someone-else", signerId: "user-b" }}
        onCancel={noop}
        onOpenDialog={noop}
        requestClosePicker={noop}
        signerName="Jan"
      />,
    );

    expect(html).toContain("Signed in by Jan");
    expect(html).toContain("Use my account");
  });

  it("renders registering as a disabled control, never a sign-in prompt", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentPickerPanel
        agentId="codex"
        availability={{ kind: "registering" }}
        onCancel={noop}
        onOpenDialog={noop}
        requestClosePicker={noop}
      />,
    );

    expect(html).toContain("Registering…");
    expect(html).toContain("disabled");
  });

  it("says nothing about a session lock when the instance is not locked out", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentPickerPanel
        agentId="codex"
        availability={{ kind: "needs-sign-in", signInKind: "not-authorized" }}
        onCancel={noop}
        onOpenDialog={noop}
        requestClosePicker={noop}
      />,
    );

    expect(html).not.toContain("New session");
  });

  // The live bug: signing in is project-wide, not per session, so the panel
  // still offers it while locked out, but says where it will actually run.
  it("names the locked agent and New session when locked out of the current session", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentPickerPanel
        agentId="codex"
        availability={{ kind: "needs-sign-in", signInKind: "not-authorized" }}
        lockedToAgentName="Claude Code"
        onCancel={noop}
        onOpenDialog={noop}
        requestClosePicker={noop}
      />,
    );

    expect(html).toContain("This session runs on Claude Code. Codex is used in a New session.");
    expect(html).toContain("Sign in to Codex");
  });
});
