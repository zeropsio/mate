import type { ZeropsAgentAuth, ZeropsAgentLoginState } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsAgentAuthorizationDialogSurface } from "./ZeropsAgentAuthorizationDialog";

const login = (
  phase: ZeropsAgentLoginState["phase"],
  overrides: Partial<ZeropsAgentLoginState> = {},
): ZeropsAgentLoginState => ({
  phase,
  terminalId: "agent-login-codex",
  startedAt: new Date("2026-09-01T12:00:00.000Z") as unknown as ZeropsAgentLoginState["startedAt"],
  ...overrides,
});

const agent = (
  agentId: ZeropsAgentAuth["agentId"],
  agentLogin?: ZeropsAgentLoginState,
): ZeropsAgentAuth => ({
  agentId,
  credPresent: false,
  flagOAuth: false,
  flagToken: false,
  providerAuth: "unknown",
  state: "not-authorized",
  ...(agentLogin === undefined ? {} : { login: agentLogin }),
});

const noop = () => {};

function render(agentAuth: ZeropsAgentAuth, projectName = "todo") {
  return renderToStaticMarkup(
    <ZeropsAgentAuthorizationDialogSurface
      agent={agentAuth}
      projectName={projectName}
      terminal={<div data-test-terminal>Live terminal</div>}
      onCancel={noop}
      onClose={noop}
      onStart={noop}
    />,
  );
}

describe("ZeropsAgentAuthorizationDialogSurface", () => {
  it("renders the idle per-ZCP modal layout with project context and a terminal pane", () => {
    const html = render(agent("codex"));

    expect(html).toContain("Authorize Codex");
    expect(html).toContain("todo");
    expect(html).toContain("zcp");
    expect(html).toContain('aria-label="Authorization progress"');
    expect(html).toContain("Start Authorization");
    expect(html).toContain("Dismiss");
    expect(html).toContain("Live terminal");
    expect(html).toContain("data-zerops-agent-authorization-dialog");
    expect(html).toContain("data-zerops-agent-authorization-terminal");
    expect(html).toContain("grid-rows-[minmax(0,1.2fr)_minmax(220px,0.8fr)]");
    expect(html).toContain("lg:grid-cols-[minmax(340px,0.36fr)_minmax(0,0.64fr)]");
    expect(html).toContain("[--terminal-background:var(--zerops-auth-terminal-surface)]");
  });

  it("pins the Codex device code and browser action in the controls column", () => {
    const html = render(
      agent(
        "codex",
        login("awaiting-browser", {
          url: "https://auth.openai.com/codex/device",
          code: "ABCD-12345",
        }),
      ),
    );

    expect(html).toContain("ABCD-12345");
    expect(html).toContain("Copy code");
    expect(html).toContain('href="https://auth.openai.com/codex/device"');
    expect(html).toContain("Open authorization page");
    expect(html).toContain("Waiting for browser confirmation");
    expect(html).toContain(">Cancel<");
  });

  it("keeps Claude's returned code inside the real terminal path", () => {
    const html = render(agent("claude-code", login("awaiting-code")));

    expect(html).toContain("Authorize Claude Code");
    expect(html).toContain("Paste the code from your browser directly into the terminal");
    expect(html).toContain("Verify code");
    expect(html).not.toContain("Device code");
    expect(html).toContain(">Cancel<");
  });

  it("offers retry with the server failure detail", () => {
    const html = render(agent("codex", login("failed", { message: "The device code expired." })));

    expect(html).toContain("The device code expired.");
    expect(html).toContain("Retry Authorization");
  });

  it("ends with an explicit completion action", () => {
    const html = render(agent("claude-code", login("succeeded")));

    expect(html).toContain("Claude Code is authorized in this ZCP");
    expect(html).toContain(">Done<");
  });
});
