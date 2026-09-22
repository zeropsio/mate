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
      />,
    );

    expect(html).toContain("Claude Code");
    expect(html).toContain("Not signed in.");
    expect(html).toContain("Sign in to Claude");
    expect(html).toContain('data-zerops-agent-availability="needs-sign-in"');
    expect(html).not.toContain("Cancel");
  });

  it("renders a signing-in agent with continue and cancel", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentPickerPanel
        agentId="codex"
        availability={{ kind: "signing-in" }}
        onCancel={noop}
        onOpenDialog={noop}
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
      />,
    );

    expect(html).toContain("Registering…");
    expect(html).toContain("disabled");
  });
});
