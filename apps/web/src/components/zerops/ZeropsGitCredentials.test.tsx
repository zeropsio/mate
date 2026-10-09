// @vitest-environment happy-dom
import { act } from "react";
import { AtomRegistry } from "effect/reactivity";
import {
  makeAccountStore,
  makeGitCredentials,
  gitCredentials,
  readsOfState,
} from "@t3tools/client-runtime/data";
import { HqError } from "@t3tools/client-runtime/zerops/hq";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
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

it("copies the HTTPS clone command and reports a refused clipboard without repeating a write", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const issue = vi.fn();
  try {
    await act(() =>
      root.render(
        <ZeropsGitCredentialsView
          state={selectGitCredentials({
            action: { kind: "idle" },
            credentials: { state: "unread", waitingFor: null },
          })}
          cloneUrl="https://hq.example/git/app/code.git"
          onIssue={issue}
          onRevoke={() => {}}
          onAgain={() => {}}
          onCopy={() => {}}
        />,
      ),
    );
    const copy = [...host.querySelectorAll("button")].find(
      (node) => node.textContent === "Copy command",
    );
    expect(copy).toBeDefined();
    await act(() => copy!.click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      "git clone https://hq.example/git/app/code.git",
    );
    expect(host.textContent).toContain("Copied");
    writeText.mockRejectedValueOnce(new Error("Clipboard refused"));
    await act(() => copy!.click());
    expect(host.textContent).toContain("Could not copy. Copy the command manually.");
    expect(issue).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

function credentialConsumer(api: Parameters<typeof makeGitCredentials>[0]["api"]) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const key = { orgId: "org", appId: "app" };
  let sequence = 0;
  const credentials = makeGitCredentials({ store, api, makeId: () => `request-${++sequence}` });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const read = () => gitCredentials.derive(readsOfState(store.state()), key);
  const draw = () =>
    root.render(
      <ZeropsGitCredentialsView
        state={read()}
        cloneUrl="https://hq.example/git/app/code.git"
        onIssue={() => {
          void credentials.issue(key);
        }}
        onRevoke={(id) => {
          void credentials.revoke(key, id);
        }}
        onAgain={() => credentials.again(key)}
        onCopy={() => {}}
      />,
    );
  const until = (predicate: () => boolean) =>
    new Promise<void>((resolve) => {
      const stop = store.subscribe(() => {
        if (predicate()) {
          stop();
          resolve();
        }
      });
      if (predicate()) {
        stop();
        resolve();
      }
    });
  const stop = store.subscribe(draw);
  const release = credentials.demand(key);
  return {
    host,
    draw,
    read,
    until,
    credentials,
    key,
    close: async () => {
      stop();
      release();
      credentials.close();
      await act(() => root.unmount());
      host.remove();
      registry.dispose();
    },
  };
}

it("Denied password access never looks like loading or enables creation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const previouslyRead of [false, true]) {
    let denied = !previouslyRead;
    const issue = vi.fn(async () => {
      throw new HqError({ kind: "refused", code: "forbidden", message: "Creation denied." });
    });
    const r = credentialConsumer({
      gitCredentials: async () => {
        if (denied)
          throw new HqError({ kind: "refused", code: "forbidden", message: "Access denied." });
        return [
          {
            id: "old-key",
            appId: "app",
            createdAt: "2026-10-09T10:00:00Z",
            expiresAt: "2026-10-09T22:00:00Z",
          },
        ];
      },
      issueGitCredential: issue,
      revokeGitCredential: async () => {},
    });
    try {
      if (previouslyRead) {
        await act(async () => {
          await r.until(() => r.read().credentials.state === "known");
          r.draw();
        });
        denied = true;
        r.credentials.again(r.key);
      }
      await act(async () => {
        await r.until(() => ["withheld", "failed"].includes(r.read().credentials.state));
        r.draw();
      });
      expect.soft(r.host.textContent).not.toContain("Reading your Git passwords");
      expect
        .soft(r.host.querySelector('[role="alert"]')?.textContent)
        .toContain(previouslyRead ? "Git password access is unavailable" : "Access denied.");
      expect.soft(r.host.textContent).not.toContain("No Git password yet");
      expect.soft(r.host.textContent).not.toContain("Created");
      const create = [...r.host.querySelectorAll("button")].find(
        (node) => node.textContent === "Create Git password",
      )!;
      expect.soft(create.disabled).toBe(true);
      await act(() => create.click());
      expect.soft(issue).not.toHaveBeenCalled();
      expect(r.host.querySelector('input[type="password"]')).toBeNull();
    } finally {
      await r.close();
    }
  }
  vi.unstubAllGlobals();
});

it("An unknown credential outcome never creates another password", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const issue = vi.fn(async () => {
    throw new HqError({ kind: "uncertain", code: "network", message: "Lost answer." });
  });
  const r = credentialConsumer({
    gitCredentials: async () => [],
    issueGitCredential: issue,
    revokeGitCredential: async () => {},
  });
  try {
    await act(async () => {
      await r.until(() => r.read().credentials.state === "known");
      r.draw();
    });
    const create = [...r.host.querySelectorAll("button")].find(
      (node) => node.textContent === "Create Git password",
    )!;
    await act(async () => {
      create.click();
      await r.until(() => r.read().action.kind === "unresolved");
    });
    expect.soft(r.host.textContent?.match(/before creating another/gu)).toHaveLength(1);
    expect.soft(create.disabled).toBe(true);
    await act(() => create.click());
    const again = [...r.host.querySelectorAll("button")].find(
      (node) => node.textContent === "Read again",
    )!;
    await act(async () => {
      again.click();
      await r.until(() => r.read().credentials.state === "known");
    });
    await act(() => create.click());
    expect(issue).toHaveBeenCalledTimes(1);
    expect(r.read().action.kind).toBe("unresolved");
  } finally {
    await r.close();
    vi.unstubAllGlobals();
  }
});
