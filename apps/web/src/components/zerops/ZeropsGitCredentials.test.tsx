import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import type { GitCredentialSnapshot } from "@t3tools/client-runtime/zerops/hq";
import { selectGitCredentials } from "@t3tools/client-runtime/zerops/hq";
import { ZeropsGitCredentialsView } from "./ZeropsGitCredentials";
const render = (state: GitCredentialSnapshot) =>
  renderToStaticMarkup(
    <ZeropsGitCredentialsView
      state={selectGitCredentials(state)}
      cloneUrl="https://hq.example/git/app/code.git"
      onIssue={() => {}}
      onRevoke={() => {}}
      onAgain={() => {}}
      onCopy={() => {}}
    />,
  );
describe("personal HTTPS Git access", () => {
  it("shows a clone address without a password and instructs the person how to authenticate", () => {
    const html = render({
      action: { kind: "idle" },
      credentials: { state: "unread", waitingFor: null },
    });
    expect(html).toContain("git clone https://hq.example/git/app/code.git");
    expect(html).toContain("person");
    expect(html).toContain("Create Git password");
    expect(html).not.toContain("No Git password");
  });
  it("shows expiry and revocation alongside a newly issued password, which is hidden by default", () => {
    const credential = {
      id: "id",
      appId: "app",
      createdAt: "now",
      expiresAt: "2026-10-04T22:00:00Z",
      token: "test-password",
    };
    const html = render({
      action: { kind: "issued", credential },
      credentials: {
        state: "known",
        value: [credential],
        asOf: { ordinal: 1, atMs: 1 },
        coverage: "complete",
        freshness: { kind: "settled" },
      },
    });
    expect(html).toContain('type="password"');
    expect(html).toContain("Copy password");
    expect(html).toContain("2026-10-04T22:00:00Z");
    expect(html).toContain("Revoke");
    expect(html).not.toContain("https://person:");
  });
  it("names a failed command and a failed first listing with manual recovery", () => {
    const html = render({
      action: { kind: "failed", words: "HQ did not answer" },
      credentials: {
        state: "failed",
        failure: { kind: "refused", code: "offline", words: "Could not list passwords" },
        atMs: 1,
        attempt: 1,
        retryAtMs: null,
      },
    });
    expect(html).toContain("HQ did not answer");
    expect(html).toContain("Could not list passwords");
    expect(html).toContain("Read again");
    expect(html).not.toContain("No Git password");
  });
});
