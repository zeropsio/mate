// @vitest-environment happy-dom
/**
 * Settings › Automation › GitHub, from what HQ answered of the organization's GitHub app: what it
 * says and offers in each state, and which call each press makes.
 */
import type { TaskSourceSettingValue } from "@t3tools/client-runtime/data";
import type { HqGithubManifestView, HqGithubView } from "@t3tools/shared/hqGithub";
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { GithubAppView } from "./GithubAppSettings";

const CONNECTED: HqGithubView = {
  state: "connected",
  slug: "acme-mate",
  name: "Acme Mate",
  botLogin: "acme-mate[bot]",
  owner: "acme",
  appUrl: "https://github.com/apps/acme-mate",
  installUrl: "https://github.com/apps/acme-mate/installations/new",
  installations: [
    {
      id: 1,
      account: "acme",
      accountType: "Organization",
      repositorySelection: "selected",
      repositories: [
        { fullName: "acme/tea-shop", private: true, defaultBranch: "main" },
        { fullName: "acme/api", private: true, defaultBranch: "main" },
        { fullName: "acme/web", private: false, defaultBranch: "main" },
      ],
      suspended: false,
      manageUrl: "https://github.com/organizations/acme/settings/installations/1",
    },
  ],
};
const MANIFEST: HqGithubManifestView = {
  postUrl: "https://github.com/organizations/acme/settings/apps/new",
  manifest: '{"name":"Acme Mate"}',
  state: ["state", "tea", "shop"].join("-"),
};
const RETURN_TO = "https://acme.example/mate/settings/automation?github=connected";
const INSTALL_LINK = `https://github.com/apps/acme-mate/installations/new?state=${MANIFEST.state}`;

const known = (held: HqGithubView) => ({ state: "known", held, stale: false });
const read = (setting: unknown, action: unknown = { kind: "idle" }) =>
  ({ setting, action, revealed: null }) as TaskSourceSettingValue<"hqGithub">;

let mounted: Array<() => void> = [];
afterEach(() => {
  for (const unmount of mounted) unmount();
  mounted = [];
  vi.unstubAllGlobals();
});

async function render(props: Partial<ComponentProps<typeof GithubAppView>> = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const controls = {
    read: read(known({ state: "none" })),
    disconnect: vi.fn(),
    again: vi.fn(),
    manifest: vi.fn(async () => MANIFEST as HqGithubManifestView | null),
    install: vi.fn(async () => INSTALL_LINK as string | null),
    accept: vi.fn(),
    suspend: vi.fn(),
    ...props.controls,
  };
  const onPost = vi.fn();
  const onOpen = vi.fn();
  await act(async () =>
    root.render(
      <GithubAppView
        admin
        onOpen={onOpen}
        onPost={onPost}
        organization="Acme"
        returnTo={RETURN_TO}
        returned={null}
        {...props}
        controls={controls}
      />,
    ),
  );
  mounted.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  const button = (text: string) =>
    [...host.querySelectorAll("button")].find((node) => node.textContent === text);
  const field = (label: string) => {
    const id = [...host.querySelectorAll("label")]
      .find((node) => node.textContent === label)
      ?.getAttribute("for");
    return id ? host.querySelector<HTMLInputElement>(`[id="${id}"]`) : null;
  };
  return { host, controls, onPost, onOpen, button, field };
}

describe("the GitHub section where no app is connected", () => {
  it("offers the Owner and Admins the app's GitHub organization and name, named after the organization, and one press to make it", async () => {
    const { host, button, field } = await render();
    expect(host.textContent).toContain("Not connected");
    expect(field("App name")).toBeNull();
    await act(async () => button("Connect")!.click());
    expect(host.textContent).toContain(
      "Everything Mate writes on GitHub appears as your organization's bot, never a person.",
    );
    expect(field("GitHub organization")?.placeholder).toBe("Your own account");
    expect(field("App name")?.value).toBe("Acme Mate");
    expect(button("Create GitHub app")).toBeDefined();
  });

  it("asks HQ for the manifest and hands it to GitHub's page, for the person's own account when no organization is typed", async () => {
    const { controls, onPost, host, button } = await render();
    await act(async () => button("Connect")!.click());
    await act(async () => {
      host.querySelector("form")!.requestSubmit();
    });
    expect(controls.manifest).toHaveBeenCalledWith({
      owner: null,
      name: "Acme Mate",
      returnTo: RETURN_TO,
    });
    expect(onPost).toHaveBeenCalledWith(MANIFEST);
  });

  it("lets the person press again after coming back from GitHub's page with Back", async () => {
    const { host, button } = await render();
    await act(async () => button("Connect")!.click());
    await act(async () => {
      host.querySelector("form")!.requestSubmit();
    });
    expect(button("Opening GitHub…")?.disabled).toBe(true);
    await act(async () => {
      const shown = new Event("pageshow");
      Object.defineProperty(shown, "persisted", { value: true });
      window.dispatchEvent(shown);
    });
    expect(button("Create GitHub app")?.disabled).toBe(false);
  });

  it("says HQ's refusal and lets the person press again", async () => {
    const { host, button, onPost } = await render({
      controls: {
        read: read(known({ state: "none" }), {
          kind: "failed",
          words: "Only the organization's Owner and Admins connect GitHub.",
        }),
        disconnect: vi.fn(),
        again: vi.fn(),
        manifest: vi.fn(async () => null),
      },
    });
    await act(async () => button("Connect")!.click());
    await act(async () => {
      host.querySelector("form")!.requestSubmit();
    });
    expect(onPost).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Only the organization's Owner and Admins connect GitHub.",
    );
    expect(button("Create GitHub app")?.disabled).toBe(false);
  });

  it("shows a member that no app is connected, and nothing to press", async () => {
    const { host } = await render({ admin: false });
    expect(host.textContent).toContain("Not connected");
    expect(host.textContent).toContain("The organization's Owner and Admins connect it.");
    expect(host.querySelector("button, input")).toBeNull();
  });

  it("asks for an update in place where HQ is older than the app", async () => {
    const { host } = await render({
      controls: {
        read: read({ state: "unsupported" }),
        disconnect: vi.fn(),
        again: vi.fn(),
        manifest: vi.fn(),
      },
    });
    expect(host.textContent).toContain("Update HQ to connect GitHub");
    expect(host.querySelector("button, input")).toBeNull();
  });
});

describe("the GitHub section once the app is connected", () => {
  const connected = {
    read: read(known(CONNECTED)),
    disconnect: vi.fn(),
    again: vi.fn(),
    manifest: vi.fn(),
    install: vi.fn(async () => INSTALL_LINK as string | null),
    accept: vi.fn(),
    suspend: vi.fn(),
  };

  it("names the bot it writes as and where it is installed, each with its page on GitHub", async () => {
    const { host, button } = await render({ controls: connected });
    expect(host.textContent).toContain("Connected as acme-mate[bot]");
    expect(host.textContent).toContain("acme · 3 repositories");
    await act(async () => button("Manage")!.click());
    const links = [...host.querySelectorAll("a")].map((a) => [a.textContent, a.href]);
    expect(links).toEqual([
      ["Manage on GitHub", "https://github.com/organizations/acme/settings/installations/1"],
    ]);
    expect(button("Install on another GitHub account or more repositories")).toBeDefined();
  });

  it("asks before disconnecting, saying the app stays on GitHub to delete there", async () => {
    const controls = { ...connected, disconnect: vi.fn() };
    const { host, button } = await render({ controls });
    await act(async () => button("Manage")!.click());
    await act(async () => button("Disconnect")!.click());
    expect(controls.disconnect).not.toHaveBeenCalled();
    expect(host.textContent).toContain("The app stays on GitHub: delete it in its settings there.");
    expect(host.textContent).toContain(
      "Repositories mirrored through it stop mirroring, and their changes stop updating on GitHub.",
    );
    await act(async () => button("Disconnect")!.click());
    expect(controls.disconnect).toHaveBeenCalledTimes(1);
  });

  it("shows a member where it is installed, with nothing to install or disconnect", async () => {
    const { host, button } = await render({ admin: false, controls: connected });
    expect(host.textContent).toContain("acme · 3 repositories");
    await act(async () => button("Manage")!.click());
    expect(button("Disconnect")).toBeUndefined();
    expect(host.textContent).not.toContain("Install on another GitHub account");
  });

  it("confirms the connection in one line once GitHub brings the person back", async () => {
    const { host } = await render({ controls: connected, returned: "connected" });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "GitHub is connected. Mate acts there as acme-mate[bot] from now on.",
    );
  });
});

it("says GitHub asked an owner to approve the app when it brings the person back without it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <GithubAppView
        admin
        controls={{
          read: read(known({ ...CONNECTED, installations: [] })),
          disconnect: vi.fn(),
          again: vi.fn(),
          manifest: vi.fn(),
          install: vi.fn(),
          accept: vi.fn(),
          suspend: vi.fn(),
        }}
        onOpen={vi.fn()}
        onPost={vi.fn()}
        organization="Acme"
        returnTo={RETURN_TO}
        returned="requested"
      />,
    ),
  );
  expect(host.querySelector('[role="status"]')?.textContent).toBe(
    "GitHub asked an owner of acme to approve the app; it's installed once they do.",
  );
  await act(async () => root.unmount());
});

it("offers Read again where HQ's answer about the app failed, and reads it again on the press", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const again = vi.fn();
  await act(async () =>
    root.render(
      <GithubAppView
        admin
        controls={{
          read: read({ state: "failed", words: "HQ isn't answering." }),
          again,
          disconnect: vi.fn(),
          manifest: vi.fn(),
          install: vi.fn(),
          accept: vi.fn(),
          suspend: vi.fn(),
        }}
        onOpen={vi.fn()}
        onPost={vi.fn()}
        organization="Acme"
        returnTo={RETURN_TO}
        returned={null}
      />,
    ),
  );
  expect(host.textContent).toContain("HQ isn't answering.");
  await act(async () =>
    [...host.querySelectorAll("button")].find((node) => node.textContent === "Read again")!.click(),
  );
  expect(again).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

describe("the GitHub app on many accounts", () => {
  const STRANGER = {
    id: 9,
    account: "stranger",
    accountType: "User" as const,
    repositorySelection: "selected" as const,
    repositories: [{ fullName: "stranger/notes", private: true, defaultBranch: "main" }],
    suspended: false,
    state: "waiting" as const,
    manageUrl: "https://github.com/settings/installations/9",
  };
  const MANY: HqGithubView = {
    ...CONNECTED,
    public: true,
    installations: [...(CONNECTED.state === "connected" ? CONNECTED.installations : []), STRANGER],
  } as HqGithubView;
  const controlsOf = (view: HqGithubView) => ({
    read: read(known(view)),
    disconnect: vi.fn(),
    again: vi.fn(),
    manifest: vi.fn(),
    install: vi.fn(async () => INSTALL_LINK as string | null),
    accept: vi.fn(),
    suspend: vi.fn(),
  });

  it("an app installed on two accounts lists both, each with its page on GitHub", async () => {
    const view = {
      ...MANY,
      installations: [
        ...(CONNECTED.state === "connected" ? CONNECTED.installations : []),
        { ...STRANGER, state: "accepted" as const },
      ],
    } as HqGithubView;
    const { host, button } = await render({ controls: controlsOf(view) });
    await act(async () => button("Manage")!.click());
    const rows = [
      ...host.querySelectorAll('[data-zerops-surface="settings-github-installations"] li'),
    ];
    expect(rows.map((row) => row.textContent)).toEqual([
      "acme · 3 repositories·Manage on GitHub",
      "stranger · 1 repository·Manage on GitHub",
    ]);
  });

  it("a private app says it installs only on its owner, with the step to make it public", async () => {
    const { host, button } = await render({
      controls: controlsOf({ ...CONNECTED, public: false } as HqGithubView),
    });
    await act(async () => button("Manage")!.click());
    expect(host.textContent).toContain(
      "This app can only be installed on acme. To add other GitHub accounts, make it public on GitHub.",
    );
    const step = [...host.querySelectorAll("a")].find(
      (a) => a.textContent === "make it public on GitHub",
    );
    expect(step?.href).toBe(
      "https://github.com/organizations/acme/settings/apps/acme-mate/advanced",
    );
  });

  it("opens HQ's install link, which brings what is installed back accepted", async () => {
    const { controls, onOpen, button } = await render({ controls: controlsOf(MANY) });
    await act(async () => button("Manage")!.click());
    await act(async () =>
      button("Install on another GitHub account or more repositories")!.click(),
    );
    expect(controls.install).toHaveBeenCalledWith(RETURN_TO);
    expect(onOpen).toHaveBeenCalledWith(INSTALL_LINK);
  });

  it("an installation not started here waits for an admin's OK, with Accept and Suspend for the Owner and Admins", async () => {
    const { host, controls, button } = await render({ controls: controlsOf(MANY) });
    expect(host.textContent).toContain("1 waiting for an OK");
    await act(async () => button("Manage")!.click());
    const waiting = host.querySelector('[data-zerops-surface="settings-github-waiting"]')!;
    expect(waiting.textContent).toContain("Waiting for your OK");
    expect(waiting.textContent).toContain("stranger");
    expect(waiting.textContent).toContain("stranger/notes");
    await act(async () => button("Accept")!.click());
    expect(controls.accept).toHaveBeenCalledWith(9);
    await act(async () => button("Suspend")!.click());
    expect(controls.suspend).toHaveBeenCalledWith(9);
  });

  it("shows a member the installation waiting for an OK, read-only", async () => {
    const { host, button } = await render({ admin: false, controls: controlsOf(MANY) });
    await act(async () => button("Manage")!.click());
    const waiting = host.querySelector('[data-zerops-surface="settings-github-waiting"]')!;
    expect(waiting.textContent).toContain("stranger/notes");
    expect(waiting.textContent).toContain("Organization admins and the owner can change this.");
    expect(button("Accept")).toBeUndefined();
    expect(button("Suspend")).toBeUndefined();
  });
});
