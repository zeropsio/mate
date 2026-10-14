// @vitest-environment happy-dom
import { act } from "react";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import {
  hqAppDetail,
  makeAccountStore,
  readsOfState,
  makeOperations,
  runToEnd,
} from "@t3tools/client-runtime/data";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { hqRefusalWords, HqError } from "@t3tools/client-runtime/zerops/hq";
import { GitRemoteLines, GitRemoteSettings } from "./GitRemoteSettings";
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
describe("Repositories in a project page's column", () => {
  it("names only the repositories that mirror somewhere, one quiet line each", () => {
    const html = renderToStaticMarkup(
      <GitRemoteLines
        now={Date.parse(remote.keptAt)}
        repos={[
          ...repos,
          { name: "mailpit", mainHead: null, updatedAt: remote.keptAt, remote: null },
        ]}
      />,
    );
    const lines = [
      ...new DOMParser().parseFromString(html, "text/html").body.querySelectorAll("li"),
    ];
    expect(lines.map((line) => line.textContent)).toEqual(["api → github.com/acme/api"]);
    expect(html).not.toMatch(/<button|No remote connected|Expiry not reported/);
  });

  it("says when the remote refused the token", () => {
    const html = renderToStaticMarkup(
      <GitRemoteLines
        repos={[{ ...repos[0]!, remote: { ...remote, invalidSince: remote.keptAt } }]}
      />,
    );
    expect(html).toContain("The remote refused Mate&#x27;s token. Replace token.");
  });
});

describe("Application repositories", () => {
  it("absent optional offers cannot expose a remote write", () => {
    const html = renderToStaticMarkup(
      <GitRemoteSettings appId="shop" repos={repos} appName="Shop" actions={actions} />,
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
          appId="shop"
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
        appId="shop"
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
          appId="shop"
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
  it.each([
    {
      title:
        "a project with no Git environment and no remote shows one line saying why to connect one",
      repos: [{ ...repos[0]!, remote: null }],
      environments: [],
      shows: [
        "Connect a GitHub repository to release this project to a Git branch.",
        ">Connect repository<",
      ],
      hides: ["api ·"],
    },
    {
      title: "a connected remote lists every code repository",
      repos: [...repos, { ...repos[0]!, name: "web", remote: null }],
      environments: [],
      shows: ["api · github.com/acme/api", "web · No remote connected"],
      hides: ["Connect a GitHub repository"],
    },
    {
      title: "a Git environment lists every code repository before any remote is connected",
      repos: [{ ...repos[0]!, remote: null }],
      environments: [{ name: "Production", target: { kind: "git" } }],
      shows: ["api · No remote connected"],
      hides: ["Connect a GitHub repository"],
    },
    {
      title: "a project with no code repository says so instead of offering a connection",
      repos: [],
      environments: [],
      shows: ["No code repository yet."],
      hides: ["<button"],
    },
  ])("$title", ({ repos: listed, environments, shows, hides }) => {
    const html = renderToStaticMarkup(
      <GitRemoteSettings
        appId="shop"
        repos={listed}
        appName="Shop"
        actions={actions}
        can={{ connect_remote: { allow: true }, replace_remote_token: { allow: true } }}
        environments={environments}
      />,
    );
    for (const text of shows) expect(html).toContain(text);
    for (const text of hides) expect(html).not.toContain(text);
  });
  it("stale offers cannot expose a mutation", () => {
    const html = renderToStaticMarkup(
      <GitRemoteSettings
        appId="shop"
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
          appId="shop"
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

it.each([
  {
    title: "a repository owned by another project shows the same refusal as production setup",
    error: async () => {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      const operations = makeOperations({
        store,
        makeId: () => "eva-connect",
        executors: {
          hq: {
            submit: () =>
              Effect.fail({
                outcome: "definitive-refusal",
                code: "remote_taken",
                message: hqRefusalWords({ code: "remote_refused", reason: "remote_taken" }),
              }),
          },
        },
      });
      try {
        await runToEnd({ operations, store, registry })(
          {
            kind: "connect-git-remote",
            orgId: "org",
            appId: "eva",
            hqProjectId: "hq",
            repo: "api",
            url: remote.url,
          },
          { orgId: "org", unobserved: "HQ is not answering." },
        );
      } finally {
        registry.dispose();
      }
    },
    expected:
      "This repository is already connected to another project. Disconnect it under Repositories on that project's page, or use another repository.",
  },
  {
    title: "a refused token shows HQ's missing permission and where to grant it",
    error: new HqError({
      kind: "refused",
      code: "git_probe_refused",
      status: 409,
      message: "Grant Contents: Read and write in GitHub's token settings.",
    }),
    expected: "Grant Contents: Read and write in GitHub's token settings.",
  },
  {
    title: "a rate-limited token test shows when HQ says to try again",
    error: new HqError({
      kind: "unavailable",
      code: "git_probe_refused",
      status: 429,
      message: "GitHub asked Mate to wait; try this token again later.",
    }),
    expected: "GitHub asked Mate to wait; try this token again later.",
  },
  {
    title: "a token write with an uncertain outcome asks the person to check its outcome",
    error: new HqError({
      kind: "uncertain",
      code: "git_probe_refused",
      message: "A write answer was lost.",
    }),
    expected: "HQ couldn't confirm the token change. Check its outcome before trying again.",
  },
  {
    title: "an unrelated token change failure keeps the outcome check",
    error: new HqError({ kind: "refused", code: "forbidden", message: "Unrelated refusal." }),
    expected: "HQ couldn't confirm the token change. Check its outcome before trying again.",
  },
  {
    title: "an untyped token change error keeps the outcome check",
    error: new Error("Unknown failure."),
    expected: "HQ couldn't confirm the token change. Check its outcome before trying again.",
  },
])("$title", async ({ error, expected }) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const replace = vi.fn(async () => {
    if (typeof error === "function") await error();
    throw error;
  });
  try {
    await act(async () =>
      root.render(
        <GitRemoteSettings
          appId="shop"
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
    expect(container.querySelector('[role="status"]')?.textContent).toBe(expected);
    expect(input.value).toBe("");
    expect(container.textContent).toContain("github.com/acme/api");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it.each(["connect", "replace", "disconnect", "address"] as const)(
  "mounted %s uses the offered account action and clears its candidate",
  async (action) => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const probe = {
      ok: true as const,
      remote: { ...remote, url: "https://github.com/acme/renamed.git" },
    };
    const supplied = {
      connect: vi.fn(async () => probe),
      replaceToken: vi.fn(async () => probe),
      disconnect: vi.fn(async () => {}),
      reviewAddress: vi.fn(async () => probe),
      updateAddress: vi.fn(async () => {}),
    };
    const click = async (label: string) => {
      await act(async () => {
        const node = [...host.querySelectorAll("button")].find(
          (button) => button.textContent === label,
        );
        expect(node, label).toBeDefined();
        node!.click();
      });
    };
    const fill = async (label: string, value: string) => {
      const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
      expect(input).not.toBeNull();
      const key = Object.keys(input).find((name) => name.startsWith("__reactProps$"))!;
      const props = Reflect.get(input, key) as {
        onChange: (event: { target: { value: string } }) => void;
      };
      await act(async () => props.onChange({ target: { value } }));
      return input;
    };
    try {
      await act(async () =>
        root.render(
          <GitRemoteSettings
            appId="shop"
            repos={action === "connect" ? [{ ...repos[0]!, remote: null }] : repos}
            appName="Shop"
            actions={supplied}
            can={{
              connect_remote: { allow: true },
              replace_remote_token: { allow: true },
              disconnect_remote: { allow: true },
              update_remote_address: { allow: true },
            }}
          />,
        ),
      );
      if (action === "disconnect") {
        await click("Disconnect");
        expect(supplied.disconnect).not.toHaveBeenCalled();
        await click("Confirm disconnect");
        expect(supplied.disconnect).toHaveBeenCalledWith("api");
      } else {
        // An unconnected project folds its repositories behind the one line's action.
        if (action === "connect") await click("Connect repository");
        await click(
          action === "connect"
            ? "Connect repository"
            : action === "replace"
              ? "Replace token"
              : "Review address",
        );
        if (action !== "replace") await fill("Repository HTTPS URL", probe.remote.url);
        const input = await fill("Candidate token", "transient-candidate");
        await click(action === "address" ? "Verify address" : "Verify and keep token");
        expect(input.value).toBe("");
        expect(host.innerHTML).not.toContain("transient-candidate");
        if (action === "connect")
          expect(supplied.connect).toHaveBeenCalledWith(
            "api",
            probe.remote.url,
            "transient-candidate",
          );
        if (action === "replace")
          expect(supplied.replaceToken).toHaveBeenCalledWith("api", "transient-candidate");
        if (action === "address") {
          expect(supplied.reviewAddress).toHaveBeenCalledWith(
            "api",
            probe.remote.url,
            "transient-candidate",
          );
          expect(supplied.updateAddress).not.toHaveBeenCalled();
          await click("Update address");
          expect(supplied.updateAddress).toHaveBeenCalledWith("api", probe.remote.url);
        }
      }
    } finally {
      await act(async () => root.unmount());
    }
  },
);

it.each(["settled", "pending"] as const)(
  "repository operation results stay with their project when verification is %s",
  async (state) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    let finish!: (value: { ok: false; reason: string }) => void;
    const result = new Promise<{ ok: false; reason: string }>((resolve) => {
      finish = resolve;
    });
    const props = {
      repos: [{ ...repos[0]!, name: "appdev" }],
      appName: "Same project name",
      can: { replace_remote_token: { allow: true } },
      actions: { replaceToken: () => result },
    };
    const render = async (appId: string) => {
      await act(async () => root.render(<GitRemoteSettings {...props} appId={appId} />));
    };
    const click = async (label: string) => {
      await act(async () =>
        [...host.querySelectorAll("button")].find((node) => node.textContent === label)!.click(),
      );
    };
    try {
      await render("eva");
      await click("Replace token");
      const input = host.querySelector<HTMLInputElement>('input[aria-label="Candidate token"]')!;
      const key = Object.keys(input).find((name) => name.startsWith("__reactProps$"))!;
      const inputProps = Reflect.get(input, key) as {
        onChange: (event: { target: { value: string } }) => void;
      };
      await act(async () => inputProps.onChange({ target: { value: "fixture-candidate" } }));
      await click("Verify and keep token");
      if (state === "settled") {
        await act(async () => finish({ ok: false, reason: "Eva's token was refused." }));
        expect(host.querySelector('[role="status"]')?.textContent).toBe("Eva's token was refused.");
      }
      await render("cyd");
      if (state === "pending")
        await act(async () => finish({ ok: false, reason: "Eva's token was refused." }));
      expect(host.textContent).toContain("appdev · github.com/acme/api");
      expect(host.querySelector('[role="status"]')).toBeNull();
      expect(host.querySelector('input[type="password"]')).toBeNull();
      expect(
        [...host.querySelectorAll("button")].find((node) => node.textContent === "Replace token")
          ?.disabled,
      ).toBe(false);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  },
);

it("a refreshed disconnect record clears only its project's repository controls", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const host = document.createElement("div");
  const root = createRoot(host);
  let revision = 0;
  const publish = (appId: string, connected: boolean) => {
    store.dispatch({
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope: `hq:org:hq-app-detail:${appId}`, generation: 1 }],
      reset: true,
      rows: [
        {
          family: "hqAppDetail",
          id: `${appId}/repos`,
          revision: { kind: "hq", incarnation: "i", revision: ++revision },
          value: {
            kind: "repos",
            value: [{ ...repos[0]!, name: "appdev", remote: connected ? remote : null }],
          },
        },
      ],
      removals: [],
    });
  };
  const render = async (appId: string) => {
    const detail = hqAppDetail.derive(readsOfState(store.state()), { orgId: "org", appId });
    await act(async () =>
      root.render(
        <GitRemoteSettings
          appId={appId}
          repos={detail.repos}
          appName={appId}
          can={{
            connect_remote: { allow: true },
            replace_remote_token: { allow: true },
            disconnect_remote: { allow: true },
            update_remote_address: { allow: true },
          }}
          actions={{ ...actions, reviewAddress: vi.fn(), updateAddress: vi.fn() }}
        />,
      ),
    );
  };
  try {
    for (const appId of ["cyd", "eva"]) {
      const key = `hq:org:hq-app-detail:${appId}` as const;
      store.dispatch({ kind: "stream", key, now: 0, event: { kind: "demand", demanded: true } });
      store.dispatch({ kind: "stream", key, now: 0, event: { kind: "attempt" } });
      publish(appId, true);
    }
    await render("cyd");
    expect(host.textContent).toContain("appdev · github.com/acme/api");
    publish("cyd", false);
    await render("cyd");
    expect(host.textContent).toContain("appdev · No remote connected");
    expect([...host.querySelectorAll("button")].map((node) => node.textContent)).toEqual([
      "Connect repository",
    ]);
    await render("eva");
    expect(host.textContent).toContain("appdev · github.com/acme/api");
    expect([...host.querySelectorAll("button")].map((node) => node.textContent)).toEqual([
      "Replace token",
      "Review address",
      "Disconnect",
    ]);
  } finally {
    await act(async () => root.unmount());
    registry.dispose();
    vi.unstubAllGlobals();
  }
});
