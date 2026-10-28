// @vitest-environment happy-dom
import { act } from "react";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import {
  hqAppDetail,
  makeAccountStore,
  readsOfState,
  makeOperations,
  OperationStopped,
  runToEnd,
} from "@t3tools/client-runtime/data";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { hqRefusalWords, HqError } from "@t3tools/client-runtime/zerops/hq";
import type { HqApplicationOffers } from "@t3tools/shared/hqOffers";
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
/** HQ's application offers to an Owner or Admin: every remote write is admitted on `structure`. */
const WRITER = { structure: { allow: true } } as const satisfies HqApplicationOffers;
/** And to anyone else in the organization. */
const MEMBER = {
  structure: { allow: false, reason: "not_structure_writer" },
} as const satisfies HqApplicationOffers;
/** The field a label names, as a person finds it. */
function labelled(host: HTMLElement, label: string): HTMLInputElement {
  const id = [...host.querySelectorAll("label")]
    .find((node) => node.textContent === label)
    ?.getAttribute("for");
  const input = id ? host.querySelector<HTMLInputElement>(`[id="${id}"]`) : null;
  expect(input, label).not.toBeNull();
  return input!;
}
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

  it("a repository mirrored through the GitHub app never shows token copy when GitHub refuses it", () => {
    const html = renderToStaticMarkup(
      <GitRemoteLines
        repos={[
          {
            ...repos[0]!,
            remote: { ...remote, via: "app", invalidSince: remote.keptAt },
          },
        ]}
      />,
    );
    expect(html).not.toMatch(/token/i);
    expect(html).toContain("GitHub refused the app");
  });
});

describe("Application repositories", () => {
  it("absent optional offers cannot expose a remote write", () => {
    const html = renderToStaticMarkup(
      <GitRemoteSettings appId="shop" repos={repos} appName="Shop" actions={actions} />,
    );
    expect(html).toContain("Mirrors to github.com/acme/api · with a token");
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
        `with a token that ${expiresAt < remote.keptAt ? "expired" : "expires"} ${expiresAt.slice(0, 10)}`,
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
        can={WRITER}
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
          can={WRITER}
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
        "Mirror a repository to GitHub or GitLab: Mate pushes what lands on its main there.",
        ">Verify and mirror<",
      ],
      hides: ["Mirrors to"],
    },
    {
      title: "a connected remote lists every code repository",
      repos: [...repos, { ...repos[0]!, name: "web", remote: null }],
      environments: [],
      shows: [
        'aria-label="api"',
        "Mirrors to github.com/acme/api",
        'aria-label="web"',
        "Not mirrored",
      ],
      hides: ["Mirror a repository to GitHub"],
    },
    {
      title: "a Git environment lists every code repository before any remote is connected",
      repos: [{ ...repos[0]!, remote: null }],
      environments: [{ name: "Production", target: { kind: "git" } }],
      shows: ['aria-label="api"', "Not mirrored"],
      hides: ["Mirror a repository to GitHub"],
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
        can={WRITER}
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
        can={WRITER}
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
          can={WRITER}
          actions={{ replaceToken: replace }}
        />,
      ),
    );
    const button = (text: string) =>
      [...container.querySelectorAll("button")].find((node) => node.textContent === text)!;
    await act(async () => button("Replace token").click());
    const input = labelled(container, "Access token");
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
    expect(container.querySelector("input[data-secret]")).not.toBeNull();
    await act(async () => button("Cancel").click());
    expect(container.querySelector("input[data-secret]")).toBeNull();
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
          can={WRITER}
          actions={{ replaceToken: replace }}
        />,
      ),
    );
    const button = (text: string) =>
      [...container.querySelectorAll("button")].find((node) => node.textContent === text)!;
    await act(async () => button("Replace token").click());
    const input = labelled(container, "Access token");
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
      const input = labelled(host, label);
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
            can={WRITER}
          />,
        ),
      );
      if (action === "disconnect") {
        await click("Disconnect");
        expect(supplied.disconnect).not.toHaveBeenCalled();
        await click("Confirm disconnect");
        expect(supplied.disconnect).toHaveBeenCalledWith("api");
      } else {
        // An unmirrored repository shows its token form plainly where no GitHub app is there.
        if (action !== "connect")
          await click(action === "replace" ? "Replace token" : "Review address");
        if (action !== "replace") await fill("Repository URL", probe.remote.url);
        const input = await fill("Access token", "transient-candidate");
        await click(
          action === "address"
            ? "Verify address"
            : action === "connect"
              ? "Verify and mirror"
              : "Verify and keep token",
        );
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
      can: WRITER,
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
      const input = labelled(host, "Access token");
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
      expect(host.textContent).toContain("Mirrors to github.com/acme/api");
      expect(host.querySelector('[role="status"]')).toBeNull();
      expect(host.querySelector("input[data-secret]")).toBeNull();
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
          can={WRITER}
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
    expect(host.textContent).toContain("Mirrors to github.com/acme/api");
    publish("cyd", false);
    await render("cyd");
    expect(host.textContent).toContain("Not mirrored");
    expect([...host.querySelectorAll("button")].map((node) => node.textContent)).toEqual([
      "Verify and mirror",
    ]);
    await render("eva");
    expect(host.textContent).toContain("Mirrors to github.com/acme/api");
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

describe("mirroring through the organization's GitHub app", () => {
  const app = {
    kind: "connected",
    name: "Acme Mate",
    repositories: ["acme/api", "acme/tea-shop"],
    installUrl: "https://github.com/apps/acme-mate/installations/new",
  } as const;
  const unmirrored = [{ ...repos[0]!, name: "appdev", remote: null }];
  const offers = WRITER;

  async function mount(props: Partial<Parameters<typeof GitRemoteSettings>[0]>) {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    const render = async (next: Partial<Parameters<typeof GitRemoteSettings>[0]>) =>
      act(async () =>
        root.render(
          <GitRemoteSettings
            appId="shop"
            appName="Shop"
            repos={unmirrored}
            can={offers}
            {...next}
          />,
        ),
      );
    await render(props);
    const buttons = () => [...host.querySelectorAll("button")].map((node) => node.textContent);
    const click = async (label: string) =>
      act(async () =>
        [...host.querySelectorAll("button")].find((node) => node.textContent === label)!.click(),
      );
    return {
      host,
      buttons,
      click,
      render,
      unmount: async () => {
        await act(async () => root.unmount());
        vi.unstubAllGlobals();
      },
    };
  }

  it("offers the app's repositories and Mirror here, with a token behind its own disclosure", async () => {
    const viaApp = vi.fn(async () => {});
    const view = await mount({ github: app, actions: { ...actions, viaApp } });
    try {
      expect(view.host.textContent).toContain("Not mirrored");
      expect(view.host.textContent).toContain("GitHub repository");
      expect(view.buttons()).toContain("Mirror here");
      expect(view.host.querySelector("input[data-secret]")).toBeNull();
      await view.click("Mirror here");
      expect(viaApp).toHaveBeenCalledWith("appdev", "acme/api");
      expect(actions.connect).not.toHaveBeenCalled();
      await view.click("Use a token instead");
      expect(view.host.querySelector("input[data-secret]")).not.toBeNull();
      expect(view.host.textContent).toContain("Repository URL");
      expect(labelled(view.host, "Repository URL").placeholder).toBe(
        "https://github.com/owner/name",
      );
    } finally {
      await view.unmount();
    }
  });

  it("an Owner or Admin installs the app on repositories through HQ's install trip; a member gets GitHub's page and is told it waits", async () => {
    const onInstall = vi.fn();
    const empty = { ...app, repositories: [], installTrip: true };
    const admin = await mount({
      github: empty,
      actions: { ...actions, viaApp: vi.fn(async () => {}) },
      admin: true,
      onInstall,
    });
    try {
      await admin.click("Install it on repositories");
      expect(onInstall).toHaveBeenCalledTimes(1);
    } finally {
      await admin.unmount();
    }
    const member = await mount({
      github: empty,
      actions: { ...actions, viaApp: vi.fn(async () => {}) },
      onInstall,
    });
    try {
      expect(
        [...member.host.querySelectorAll("a")].find(
          (a) => a.textContent === "Install it on repositories",
        )?.href,
      ).toBe(app.installUrl);
      expect(member.host.textContent).toContain("What you install there waits for an admin's OK.");
    } finally {
      await member.unmount();
    }
  });

  it("says an account the app is installed on waits for an admin's OK, with the way there for an admin", async () => {
    const onOpenAutomation = vi.fn();
    const view = await mount({
      github: {
        ...app,
        installTrip: true,
        waiting: [{ account: "stranger", repositories: ["stranger/notes"] }],
      },
      actions: { ...actions, viaApp: vi.fn(async () => {}) },
      admin: true,
      onOpenAutomation,
    });
    try {
      expect(view.host.textContent).toContain(
        "stranger waits for an admin's OK in Settings › Automation.",
      );
      await view.click("Open Settings › Automation");
      expect(onOpenAutomation).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
    }
  });

  it("offers a person whose GitHub account the app does not reach yet to add one, through HQ's install trip, beside the repositories it reaches", async () => {
    const onInstall = vi.fn();
    const view = await mount({
      github: {
        ...app,
        installTrip: true,
        waiting: [{ account: "lukas-dev", repositories: ["lukas-dev/tea-shop"] }],
      },
      actions: { ...actions, viaApp: vi.fn(async () => {}) },
      admin: true,
      onInstall,
    });
    try {
      expect(view.buttons()).toContain("Mirror here");
      expect(view.host.textContent).toContain(
        "lukas-dev waits for an admin's OK in Settings › Automation.",
      );
      await view.click("Add a GitHub account or repository…");
      expect(onInstall).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
    }
  });

  it.each([
    { case: "the app connected", github: app },
    { case: "no app", github: { kind: "none" } as const },
  ])(
    "a person HQ does not let mirror reads who can, and no way to mirror, with $case",
    async ({ github }) => {
      const view = await mount({
        github,
        can: MEMBER,
        actions: { ...actions, viaApp: vi.fn(async () => {}) },
        admin: false,
        onOpenAutomation: vi.fn(),
      });
      try {
        expect(view.host.textContent).toContain("Not mirrored");
        expect(view.host.textContent).toContain(
          "Only an Owner or Admin of the organization can mirror this project's code.",
        );
        expect(view.buttons()).toEqual([]);
        expect(view.host.querySelector("input, [role=combobox]")).toBeNull();
      } finally {
        await view.unmount();
      }
    },
  );

  it("says Saving… while HQ mirrors it, then where it mirrors to and through which app", async () => {
    let finish!: () => void;
    const viaApp = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = await mount({ github: app, actions: { ...actions, viaApp } });
    try {
      await view.click("Mirror here");
      expect(view.host.querySelector("[data-zerops-mirror-state]")?.textContent).toBe("Saving…");
      expect(view.host.textContent).not.toContain("Waiting for HQ");
      await view.render({
        github: app,
        actions: { ...actions, viaApp },
        repos: [
          {
            ...unmirrored[0]!,
            remote: { ...remote, url: "https://github.com/acme/api", via: "app" },
          },
        ],
      });
      await act(async () => finish());
      expect(view.host.querySelector("[data-zerops-mirror-state]")?.textContent).toBe(
        "Mirrors to github.com/acme/api · through Acme Mate",
      );
      expect(view.buttons()).not.toContain("Replace token");
    } finally {
      await view.unmount();
    }
  });

  it("points to Settings › Automation where no GitHub app is connected, beside the token form", async () => {
    const onOpenAutomation = vi.fn();
    const view = await mount({ github: { kind: "none" }, actions, onOpenAutomation });
    try {
      expect(view.host.querySelector("input[data-secret]")).not.toBeNull();
      expect(view.host.textContent).toContain(
        "Or connect GitHub in Settings › Automation to mirror without a token.",
      );
      await view.click("Settings › Automation");
      expect(onOpenAutomation).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
    }
  });

  it("offers a token mirror the app reaches to move to the app", async () => {
    const viaApp = vi.fn(async () => {});
    const view = await mount({ github: app, actions: { ...actions, viaApp }, repos });
    try {
      expect(view.host.textContent).toContain("Mirrors to github.com/acme/api · with a token");
      await view.click("Use Acme Mate instead");
      expect(viaApp).toHaveBeenCalledWith("api", "acme/api");
      await view.render({
        github: { ...app, repositories: ["acme/tea-shop"] },
        actions: { ...actions, viaApp },
        repos,
      });
      expect(view.buttons()).not.toContain("Use Acme Mate instead");
    } finally {
      await view.unmount();
    }
  });

  it("a followed repository says the GitHub repository it follows, and offers Connect on GitHub and Stop following to who may connect", async () => {
    const viaApp = vi.fn(async () => {});
    const unfollow = vi.fn(async () => {});
    const followed = [{ ...unmirrored[0]!, follows: "https://github.com/acme/tea-shop.git" }];
    const view = await mount({
      github: app,
      actions: { ...actions, viaApp, unfollow },
      repos: followed,
    });
    try {
      expect(view.host.querySelector("[data-zerops-mirror-state]")?.textContent).toBe(
        "Follows github.com/acme/tea-shop · Mate keeps the code",
      );
      expect(view.buttons()).toEqual([
        "Connect on GitHub",
        "Stop following",
        "Use a token instead",
      ]);
      await view.click("Connect on GitHub");
      expect(viaApp).toHaveBeenCalledWith("appdev", "acme/tea-shop");
      await view.click("Stop following");
      expect(unfollow).not.toHaveBeenCalled();
      expect(view.host.textContent).toContain("The repository stays on GitHub.");
      await view.click("Cancel");
      expect(unfollow).not.toHaveBeenCalled();
      await view.click("Stop following");
      await view.click("Confirm stop following");
      expect(unfollow).toHaveBeenCalledWith("appdev");
      await view.render({
        github: app,
        actions: { ...actions, viaApp, unfollow },
        repos: followed,
        can: {},
      });
      expect(view.host.querySelector("[data-zerops-mirror-state]")?.textContent).toBe(
        "Follows github.com/acme/tea-shop · Mate keeps the code",
      );
      expect(view.buttons()).toEqual([]);
    } finally {
      await view.unmount();
    }
  });

  it("says HQ's refusal to stop following where Stop following stood", async () => {
    const unfollow = vi.fn(async () => {
      throw new OperationStopped(
        "Only the organization's owner or admin can change this.",
        "not_structure_writer",
      );
    });
    const view = await mount({
      github: app,
      actions: { ...actions, unfollow },
      repos: [{ ...unmirrored[0]!, follows: "https://github.com/acme/tea-shop.git" }],
    });
    try {
      await view.click("Stop following");
      await view.click("Confirm stop following");
      expect(view.host.textContent).toContain(
        "Only the organization's owner or admin can change this.",
      );
    } finally {
      await view.unmount();
    }
  });

  it("a repository HQ offers for deletion shows Delete repository in the project's repository list; one HQ does not offer shows no such action", async () => {
    const deleteRepository = vi.fn(async () => {});
    const view = await mount({
      actions: { ...actions, deleteRepository },
      repos: [
        { ...unmirrored[0]!, name: "appdev", canDelete: { allow: true } },
        {
          ...unmirrored[0]!,
          name: "mailpit",
          canDelete: { allow: false, reason: "in_use:remote" },
        },
        { ...unmirrored[0]!, name: "older" },
      ],
    });
    try {
      const sections = [...view.host.querySelectorAll("section")].map((section) => [
        section.getAttribute("aria-label"),
        [...section.querySelectorAll("button")]
          .map((node) => node.textContent)
          .includes("Delete repository"),
      ]);
      expect(sections).toEqual([
        ["appdev", true],
        ["mailpit", false],
        ["older", false],
      ]);
      await view.render({
        actions,
        repos: [{ ...unmirrored[0]!, canDelete: { allow: true } }],
      });
      expect(view.buttons()).not.toContain("Delete repository");
    } finally {
      await view.unmount();
    }
  });

  it("deleting asks for confirmation naming the repository and saying its code is deleted from Mate while the GitHub repository stays; nothing is sent before the confirm", async () => {
    const deleteRepository = vi.fn(async () => {});
    const view = await mount({
      actions: { ...actions, deleteRepository },
      repos: [{ ...unmirrored[0]!, canDelete: { allow: true } }],
    });
    try {
      await view.click("Delete repository");
      expect(deleteRepository).not.toHaveBeenCalled();
      expect(view.host.textContent).toContain("Delete appdev?");
      expect(view.host.textContent).toContain("Its code is deleted from Mate.");
      expect(view.host.textContent).toContain("The GitHub repository, if any, stays.");
      await view.click("Cancel");
      expect(deleteRepository).not.toHaveBeenCalled();
      expect(view.buttons()).toContain("Delete repository");
      await view.click("Delete repository");
      await view.click("Confirm delete");
      expect(deleteRepository).toHaveBeenCalledExactlyOnceWith("appdev");
    } finally {
      await view.unmount();
    }
  });

  it("when HQ refuses to delete a repository, the person reads why in plain words", async () => {
    const reason = "in_use:open_change";
    const deleteRepository = vi.fn(async () => {
      throw new OperationStopped(hqRefusalWords({ code: "conflict", reason }), reason);
    });
    const view = await mount({
      actions: { ...actions, deleteRepository },
      repos: [{ ...unmirrored[0]!, canDelete: { allow: true } }],
    });
    try {
      await view.click("Delete repository");
      await view.click("Confirm delete");
      expect(view.host.textContent).toContain(
        "This repository has an open change. Merge or close it first.",
      );
      expect(view.buttons()).toContain("Delete repository");
    } finally {
      await view.unmount();
    }
  });

  it("a deleted repository stays in the list until HQ's record says it is gone", async () => {
    const kept = { ...unmirrored[0]!, name: "other" };
    const view = await mount({
      actions: { ...actions, deleteRepository: vi.fn(async () => {}) },
      repos: [{ ...unmirrored[0]!, canDelete: { allow: true } }, kept],
    });
    try {
      await view.click("Delete repository");
      await view.click("Confirm delete");
      expect(view.host.textContent).toContain("appdev");
      await view.render({ repos: [kept] });
      expect(
        [...view.host.querySelectorAll("section")].map((s) => s.getAttribute("aria-label")),
      ).toEqual(["other"]);
    } finally {
      await view.unmount();
    }
  });

  // live gate 2026-10-21 (D2): a way in needs a way out.
  it("a repository mirrored through the app offers the way back to a token", async () => {
    const probe = { ok: true as const, remote };
    const replaceToken = vi.fn(async () => probe);
    const view = await mount({
      github: app,
      actions: { ...actions, replaceToken, viaApp: vi.fn(async () => {}) },
      repos: [{ ...repos[0]!, remote: { ...remote, via: "app" } }],
    });
    try {
      expect(view.host.textContent).toContain("Mirrors to github.com/acme/api · through Acme Mate");
      expect(view.buttons()).toContain("Use a token instead");
      await view.click("Use a token instead");
      expect(view.host.textContent).not.toContain("Repository URL");
      const input = labelled(view.host, "Access token");
      const key = Object.keys(input).find((name) => name.startsWith("__reactProps$"))!;
      const props = Reflect.get(input, key) as {
        onChange: (event: { target: { value: string } }) => void;
      };
      await act(async () => props.onChange({ target: { value: "transient-candidate" } }));
      await view.click("Verify and keep token");
      expect(replaceToken).toHaveBeenCalledWith("api", "transient-candidate");
    } finally {
      await view.unmount();
    }
  });

  // live gate 2026-10-21 (D1): the line read as a precondition of the switch, and stood alone after it.
  it.each([
    { name: "in Disconnect's place, where HQ offers Disconnect", can: offers, shown: true },
    { name: "nowhere, where HQ offers no Disconnect", can: MEMBER, shown: false },
  ])("names the Git environments that keep a remote $name", async ({ can, shown }) => {
    const view = await mount({
      github: app,
      can,
      actions: { ...actions, viaApp: vi.fn(async () => {}) },
      repos,
      environments: [{ name: "Production", target: { kind: "git" } }],
    });
    try {
      expect(view.buttons().includes("Use Acme Mate instead")).toBe(shown);
      expect(view.host.textContent?.includes("Remove those Git environments first")).toBe(shown);
      expect(view.buttons()).not.toContain("Disconnect");
    } finally {
      await view.unmount();
    }
  });

  it("says HQ's refusal to disconnect, not that HQ couldn't confirm", async () => {
    const reason = "Only the organization's owner or admin can change this.";
    const refuse = vi.fn(async () => {
      throw new OperationStopped(reason, "not_structure_writer");
    });
    const view = await mount({
      github: app,
      actions: { ...actions, disconnect: refuse },
      repos,
    });
    try {
      await view.click("Disconnect");
      await view.click("Confirm disconnect");
      expect(view.host.textContent).toContain(reason);
      expect(view.host.textContent).not.toContain("couldn't confirm");
    } finally {
      await view.unmount();
    }
  });

  it("paints nothing of a repository until the app is read", async () => {
    const view = await mount({ github: null, actions });
    try {
      expect(view.host.textContent).toBe("Reading repositories…");
    } finally {
      await view.unmount();
    }
  });
});

it("a repository mirrored through the app says whether GitHub governs its main, naming the app id a ruleset requires", () => {
  const html = renderToStaticMarkup(
    <GitRemoteSettings
      appId="shop"
      appName="Shop"
      github={{
        kind: "connected",
        name: "Acme Mate",
        appId: 123456,
        repositories: ["acme/tea-shop"],
        installUrl: "https://github.com/apps/acme-mate/installations/new",
      }}
      repos={[{ ...repos[0]!, remote: { ...remote, via: "app", governance: "gate_not_pinned" } }]}
    />,
  );
  expect(html).toContain("Mirrors to github.com/acme/api · through Acme Mate");
  expect(html).toContain("Main is not protected. The mate/gate check its ruleset requires");
  expect(html).toContain("Require it from app ID 123456 so only Mate can.");
});

// live gate 2026-10-21 (D3): a ruleset added on GitHub reads as protected up to a minute later.
it.each([
  { governance: "no_ruleset", hint: true },
  { governance: "governed", hint: true },
  { governance: undefined, hint: false },
] as const)(
  "says Mate checks GitHub's rules every minute, under whether main is protected: $governance",
  ({ governance, hint }) => {
    const html = renderToStaticMarkup(
      <GitRemoteSettings
        appId="shop"
        appName="Shop"
        github={{
          kind: "connected",
          name: "Acme Mate",
          repositories: ["acme/api"],
          installUrl: "https://github.com/apps/acme-mate/installations/new",
        }}
        repos={[
          {
            ...repos[0]!,
            remote: { ...remote, via: "app", ...(governance === undefined ? {} : { governance }) },
          },
        ]}
      />,
    );
    expect(html.includes("Mate checks GitHub&#x27;s rules every minute.")).toBe(hint);
  },
);

it("a diverged mirror says nothing moves until both mains match, never that it mirrors", () => {
  const html = renderToStaticMarkup(
    <GitRemoteSettings
      appId="shop"
      appName="Shop"
      repos={[{ ...repos[0]!, remote: { ...remote, divergedSince: "2026-10-16T12:00:00Z" } }]}
    />,
  );
  expect(html).toContain("differ since 2026-10-16 — nothing moves until they match");
  expect(html).not.toContain("Mirrors to");
});

it("Stop following returns a followed repository to not mirrored once HQ's record no longer follows it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const host = document.createElement("div");
  const root = createRoot(host);
  let revision = 0;
  const key = "hq:org:hq-app-detail:shop" as const;
  const publish = (follows: string | undefined) =>
    store.dispatch({
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope: key, generation: 1 }],
      reset: true,
      rows: [
        {
          family: "hqAppDetail",
          id: "shop/repos",
          revision: { kind: "hq", incarnation: "i", revision: ++revision },
          value: {
            kind: "repos",
            value: [
              {
                ...repos[0]!,
                name: "appdev",
                remote: null,
                ...(follows === undefined ? {} : { follows }),
              },
            ],
          },
        },
      ],
      removals: [],
    });
  const render = async () =>
    act(async () =>
      root.render(
        <GitRemoteSettings
          appId="shop"
          repos={
            hqAppDetail.derive(readsOfState(store.state()), { orgId: "org", appId: "shop" }).repos
          }
          appName="Shop"
          can={WRITER}
          // HQ's record answers the stop.
          actions={{
            unfollow: async () => {
              publish(undefined);
            },
          }}
        />,
      ),
    );
  try {
    store.dispatch({ kind: "stream", key, now: 0, event: { kind: "demand", demanded: true } });
    store.dispatch({ kind: "stream", key, now: 0, event: { kind: "attempt" } });
    publish("https://github.com/acme/tea-shop.git");
    await render();
    expect(host.querySelector("[data-zerops-mirror-state]")?.textContent).toBe(
      "Follows github.com/acme/tea-shop · Mate keeps the code",
    );
    for (const label of ["Stop following", "Confirm stop following"])
      await act(async () =>
        [...host.querySelectorAll("button")].find((node) => node.textContent === label)!.click(),
      );
    await render();
    expect(host.querySelector("[data-zerops-mirror-state]")?.textContent).toBe("Not mirrored");
    expect([...host.querySelectorAll("button")].map((node) => node.textContent)).not.toContain(
      "Stop following",
    );
  } finally {
    await act(async () => root.unmount());
    registry.dispose();
    vi.unstubAllGlobals();
  }
});
