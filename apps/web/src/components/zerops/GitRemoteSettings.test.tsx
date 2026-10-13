// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { GitRemoteSettings } from "./GitRemoteSettings";
const remote = {
  url: "https://github.com/acme/api.git",
  repositoryId: "1",
  keptAt: "2026-10-13T10:00:00Z",
  keptBy: "Zerops custodian",
  expiresAt: null,
  invalidSince: null,
};
const repos = [{ name: "api", mainHead: "a".repeat(40), updatedAt: remote.keptAt, remote }];
const actions = { replaceToken: vi.fn(), disconnect: vi.fn(), connect: vi.fn() };
describe("Application repositories", () => {
  it("absent optional offers cannot expose a remote write", () => {
    const html = renderToStaticMarkup(
      <GitRemoteSettings repos={repos} appName="Shop" actions={actions} />,
    );
    expect(html).toContain("github.com/acme/api");
    expect(html).toContain("Expiry not reported");
    expect(html).not.toMatch(/<button|Candidate token|No expiry|GitHub token owner/);
    expect(actions.replaceToken).not.toHaveBeenCalled();
    expect(actions.disconnect).not.toHaveBeenCalled();
  });
  it.each(["2026-10-01T00:00:00Z", "2026-10-20T00:00:00Z"])(
    "reports the proven expiry %s",
    (expiresAt) => {
      const html = renderToStaticMarkup(
        <GitRemoteSettings
          repos={[{ ...repos[0]!, remote: { ...remote, expiresAt } }]}
          appName="Shop"
          now={Date.parse(remote.keptAt)}
        />,
      );
      expect(html).toContain(
        `${expiresAt < remote.keptAt ? "Token expired" : "Token expires"} ${expiresAt.slice(0, 10)}`,
      );
      expect(html).not.toContain("Expiry not reported");
    },
  );
  it("disconnect stays absent while either Git environment depends on the remote", () => {
    const html = renderToStaticMarkup(
      <GitRemoteSettings
        repos={repos}
        appName="Shop"
        actions={actions}
        can={{ disconnect_remote: { allow: true } }}
        environments={[
          { name: "Stage", target: { kind: "git" } },
          { name: "Production", target: { kind: "git" } },
        ]}
      />,
    );
    expect(html).toContain("Remove those Git environments first");
    expect(html).toContain("Stage, Production");
    expect(html).not.toContain(">Disconnect<");
  });
  it.each(["1", "different"])(
    "address review preserves only the verified same repository id %s",
    (repositoryId) => {
      const html = renderToStaticMarkup(
        <GitRemoteSettings
          repos={repos}
          appName="Shop"
          can={{ update_remote_address: { allow: true } }}
          actions={{
            addressReview: {
              repo: "api",
              verified: {
                ok: true,
                remote: { ...remote, repositoryId, url: "https://github.com/acme/renamed.git" },
              },
              confirm: vi.fn(),
            },
          }}
        />,
      );
      expect(html.includes("Update address")).toBe(repositoryId === "1");
      expect(html).not.toContain("Force");
    },
  );
  it("stale offers cannot expose a mutation", () => {
    const html = renderToStaticMarkup(
      <GitRemoteSettings
        repos={repos}
        appName="Shop"
        can={{ replace_remote_token: { allow: true }, disconnect_remote: { allow: true } }}
        actions={actions}
        live={false}
      />,
    );
    expect(html).not.toContain("<button");
  });
});

it("candidate token is cleared before verification and failed verification keeps HQ's old remote", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const replace = vi.fn(async () => ({
    ok: false as const,
    reason: "The host refused this candidate.",
  }));
  try {
    await act(async () =>
      root.render(
        <GitRemoteSettings
          repos={repos}
          appName="Shop"
          can={{ replace_remote_token: { allow: true } }}
          actions={{ replaceToken: replace }}
        />,
      ),
    );
    const button = (text: string) =>
      [...container.querySelectorAll("button")].find((node) => node.textContent === text)!;
    await act(async () => button("Replace token").click());
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Candidate token"]')!;
    const key = Object.keys(input).find((name) => name.startsWith("__reactProps$"))!;
    const props = Reflect.get(input, key) as {
      onChange: (event: { target: { value: string } }) => void;
    };
    await act(async () => props.onChange({ target: { value: "fixture-candidate" } }));
    await act(async () => button("Verify and keep token").click());
    expect(replace).toHaveBeenCalledWith("api", "fixture-candidate");
    expect(input.value).toBe("");
    expect(container.textContent).toContain("The host refused this candidate.");
    expect(container.textContent).toContain("github.com/acme/api");
    expect(container.textContent).not.toContain("kept in HQ");
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    await act(async () => button("Cancel").click());
    expect(container.querySelector('input[type="password"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
