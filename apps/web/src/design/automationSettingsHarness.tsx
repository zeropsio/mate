/**
 * Settings › Automation and the mirror dialog, in each of their states, from fixtures.
 *
 * Served by the dev server at `/design-automation.html` (`?theme=dark`). Open it at the owner's
 * 1786 × 1000. `?view=` picks one state: `none` (an Owner, no GitHub app), `connected`, `older`
 * (an HQ older than the app), `member`, `dialog` (the mirror dialog's repositories, each state).
 *
 * Fixtures only. Nothing here ships — `design-automation.html` is not `index.html`, and no route
 * imports this module.
 */
import type { OrgAiKeysRead, TaskSourceSettingValue } from "@t3tools/client-runtime/data";
import type { HqGithubView } from "@t3tools/shared/hqGithub";
import { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { OrganizationKeyView } from "~/components/settings/AutomatedMatesSettings";
import { GithubAppView } from "~/components/settings/GithubAppSettings";
import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import {
  DiscordSettingsView,
  SlackSettingsView,
  TaskLimitsView,
} from "~/components/settings/TaskSourcesSettings";
import { GitRemoteSettings, type GitMirrorApp } from "~/components/zerops/GitRemoteSettings";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const view = params.get("view") ?? "connected";
const NEBIUS = OPENCODE_KEY_PROVIDERS.find((provider) => provider.id === "nebius")!;
const nothing = () => {};

const KEY_SET: OrgAiKeysRead = {
  keys: {
    state: "known",
    keys: [{ provider: "nebius", set: true, setAt: "2026-10-17T09:00:00.000Z" }],
    stale: false,
  },
  action: { kind: "idle" },
};
const known = (value: unknown) => ({ state: "known", held: value, stale: false });
const controls = (setting: unknown) => ({
  read: { setting, action: { kind: "idle" }, revealed: null } as TaskSourceSettingValue<never>,
  write: nothing,
  again: nothing,
});
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
const SLACK = {
  connected: true,
  workspace: "Acme",
  eventsUrl: "https://hq-acme.zerops.app/api/intake/slack/acme",
};
const DISCORD_OFF = {
  connected: false,
  interactionsUrl: "https://hq-acme.zerops.app/api/intake/discord/acme",
  inviteUrl: null,
  allowed: [],
};

function Page({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-8 py-10 text-foreground">
      <div className="mx-auto max-w-4xl">{children}</div>
    </div>
  );
}

function Automation({ github, admin }: { readonly github: unknown; readonly admin: boolean }) {
  const app = (
    <GithubAppView
      admin={admin}
      controls={{
        read: controls(github).read as TaskSourceSettingValue<"hqGithub">,
        disconnect: nothing,
        manifest: async () => null,
      }}
      onPost={nothing}
      organization="Acme"
      returnTo="https://acme.example/mate/settings/automation?github=connected"
      returned={false}
    />
  );
  return (
    <Page>
      <SettingsSection title="Automation">
        {admin ? (
          <>
            <OrganizationKeyView
              onAgain={nothing}
              onRemove={nothing}
              onSet={nothing}
              provider={NEBIUS}
              read={KEY_SET}
            />
            {app}
            <SlackSettingsView controls={controls(known(SLACK))} />
            <DiscordSettingsView controls={controls(known(DISCORD_OFF))} />
            <TaskLimitsView controls={controls(known({ minutes: 60, costUsd: 5 }))} />
          </>
        ) : (
          <>
            <SettingsRow
              description="Pays for the open models automated Mates run on."
              status="Only the organization's Owner and Admins see and change this."
              title="Model key"
            />
            {app}
          </>
        )}
      </SettingsSection>
    </Page>
  );
}

const REMOTE = {
  url: "https://github.com/acme/tea-shop.git",
  repositoryId: "7",
  keptAt: "2026-10-17T09:00:00Z",
  keptBy: "Ales",
  expiresAt: "2027-10-17T09:00:00Z",
  invalidSince: null,
};
const APP: GitMirrorApp = {
  kind: "connected",
  name: "Acme Mate",
  repositories: ["acme/api", "acme/tea-shop", "acme/web"],
  installUrl: CONNECTED.installUrl,
};
const OFFERS = {
  connect_remote: { allow: true },
  replace_remote_token: { allow: true },
  disconnect_remote: { allow: true },
  update_remote_address: { allow: true },
};
const ACTIONS = {
  connect: async () => ({ ok: false as const, reason: "Fixture." }),
  replaceToken: async () => ({ ok: false as const, reason: "Fixture." }),
  disconnect: async () => {},
  viaApp: async () => {},
};
const repo = (name: string, remote: unknown) =>
  ({ name, mainHead: null, updatedAt: null, remote }) as never;

/** The dialog's panel, drawn in place: the popup's width and padding, never its portal. */
function DialogFrame({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="w-[32rem] rounded-2xl border border-border bg-popover p-6 shadow-lg">
      <h2 className="text-base font-semibold">Mirror code to GitHub or GitLab</h2>
      <p className="text-sm text-muted-foreground">
        Each repository of Tea Shop pushes what lands on its main to a repository you own.
      </p>
      <p className="mt-1 text-xs text-muted-foreground uppercase">{title}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Dialogs() {
  return (
    <div className="flex min-h-screen flex-wrap content-start gap-6 bg-background p-8 text-foreground">
      <DialogFrame title="App connected, not mirrored">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={OFFERS}
          github={APP}
          repos={[repo("appdev", null)]}
        />
      </DialogFrame>
      <DialogFrame title="No app, not mirrored">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={OFFERS}
          github={{ kind: "none" }}
          onOpenAutomation={nothing}
          repos={[repo("appdev", null)]}
        />
      </DialogFrame>
      <DialogFrame title="Mirrored through the app">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={OFFERS}
          github={APP}
          repos={[repo("appdev", { ...REMOTE, via: "app", expiresAt: null })]}
        />
      </DialogFrame>
      <DialogFrame title="Mirrored with a token, app connected">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={OFFERS}
          github={APP}
          repos={[repo("appdev", { ...REMOTE, via: "token" })]}
        />
      </DialogFrame>
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      {view === "dialog" ? (
        <Dialogs />
      ) : (
        <Automation
          admin={view !== "member"}
          github={
            view === "none"
              ? known({ state: "none" })
              : view === "older"
                ? { state: "unsupported" }
                : known(CONNECTED)
          }
        />
      )}
    </StrictMode>,
  );
}
