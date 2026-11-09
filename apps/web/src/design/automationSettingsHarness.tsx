/**
 * Settings › Automation and the mirror dialog, in each of their states, from fixtures.
 *
 * Served by the dev server at `/design-automation.html` (`?theme=dark`). Open it at the owner's
 * 1786 × 1000. `?view=` picks one state: `none` (an Owner, no GitHub app), `open` (every Connect
 * pressed, Add a GitHub app among them), `checking` (every read under way), `connected` (one app),
 * `two` (two apps, one on a person's account, an account waiting), `add` (two apps, Add a GitHub app
 * pressed), `remove` (the personal app's remove guard), `unsealed` / `unsealed-member` (an app
 * nobody confirmed), `private`, `manage` (Discord connected, its Manage open), `slack-refused`
 * (Slack's signatures refused, its Replace open), `older` (an HQ older than the apps), `member`,
 * `many-member`, `dialog` (the mirror dialog's repositories, each state), `model` (the automated
 * Mates' model picker open).
 *
 * Fixtures only. Nothing here ships — `design-automation.html` is not `index.html`, and no route
 * imports this module.
 */
import type { OrgAiKeysRead, TaskSourceSettingValue } from "@t3tools/client-runtime/data";
import type { HqGithubView } from "@t3tools/shared/hqGithub";
import type { HqApplicationOffers } from "@t3tools/shared/hqOffers";
import { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";
import type { HqTaskLimitsView } from "@t3tools/shared/hqIntake";
import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { OrganizationKeyView } from "~/components/settings/AutomatedMatesSettings";
import { GithubAppView } from "~/components/settings/GithubAppSettings";
import { IntegrationList, LimitsList } from "~/components/settings/IntegrationRow";
import { SettingsSection } from "~/components/settings/settingsLayout";
import {
  AutomatedModelView,
  DiscordSettingsView,
  MonthlyBudgetView,
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
type FixtureApp = HqGithubView["apps"][number];
const repository = (
  id: number,
  fullName: string,
  usedBy: { readonly application: string; readonly repo: string } | null = null,
) => ({ id, fullName, private: true, defaultBranch: "main", usedBy });
// The organization's own app, on its GitHub organization, two repositories connected.
const ACME: FixtureApp = {
  appId: 101,
  slug: "acme-mate",
  name: "Acme Mate",
  botLogin: "acme-mate[bot]",
  owner: "acme",
  ownerType: "Organization",
  appUrl: "https://github.com/apps/acme-mate",
  installUrl: "https://github.com/apps/acme-mate/installations/new",
  public: true,
  sealedBy: "user-dana",
  sealedAt: "2026-11-09T09:00:00Z",
  installations: [
    {
      id: 1,
      account: "acme",
      accountType: "Organization",
      repositorySelection: "selected",
      repositories: [
        repository(11, "acme/tea-shop", { application: "app-tea", repo: "appdev" }),
        repository(12, "acme/api", { application: "app-api", repo: "apidev" }),
        repository(13, "acme/web"),
      ],
      suspended: false,
      state: "accepted",
      manageUrl: "https://github.com/organizations/acme/settings/installations/1",
      addedBy: "user-dana",
    },
  ],
};
// A teammate's app on their own account, installed on theirs and a partner's.
const PERSONAL: FixtureApp = {
  appId: 102,
  slug: "octo-mate",
  name: "Octo Mate",
  botLogin: "octo-mate[bot]",
  owner: "jane-k",
  ownerType: "User",
  appUrl: "https://github.com/apps/octo-mate",
  installUrl: "https://github.com/apps/octo-mate/installations/new",
  public: true,
  sealedBy: "user-jane",
  sealedAt: "2026-11-08T15:00:00Z",
  installations: [
    {
      id: 2,
      account: "jane-k",
      accountType: "User",
      repositorySelection: "all",
      repositories: [
        repository(21, "jane-k/notes", { application: "app-notes", repo: "notesdev" }),
      ],
      suspended: false,
      state: "accepted",
      manageUrl: "https://github.com/settings/installations/2",
      addedBy: "user-jane",
    },
    {
      id: 3,
      account: "octo-org",
      accountType: "Organization",
      repositorySelection: "selected",
      repositories: [
        repository(31, "octo-org/site", { application: "app-tea", repo: "sitedev" }),
        repository(32, "octo-org/api"),
      ],
      suspended: false,
      state: "accepted",
      manageUrl: "https://github.com/organizations/octo-org/settings/installations/3",
      addedBy: null,
    },
    {
      id: 4,
      account: "stranger-labs",
      accountType: "Organization",
      repositorySelection: "selected",
      repositories: [repository(41, "stranger-labs/site")],
      suspended: false,
      state: "waiting",
      manageUrl: "https://github.com/organizations/stranger-labs/settings/installations/4",
      addedBy: null,
    },
  ],
};
// An app nobody vouched for: Mate uses it for nothing until an Owner or Admin confirms it.
const UNSEALED: FixtureApp = { ...ACME, sealedBy: null, sealedAt: null };
const ONE: HqGithubView = { apps: [ACME] };
const TWO: HqGithubView = { apps: [ACME, PERSONAL] };
const PEOPLE: Record<string, string> = { "user-dana": "Dana K.", "user-jane": "Jane K." };
const APPLICATIONS: Record<string, string> = {
  "app-tea": "Tea shop",
  "app-api": "Orders API",
  "app-notes": "Notes",
};
const SLACK = {
  connected: true,
  workspace: "Acme",
  eventsUrl: "https://hq-acme.zerops.app/api/intake/slack/acme",
};
// As HQ answers before a connection: it makes Discord's address as it connects.
const DISCORD_OFF = { connected: false, interactionsUrl: "", inviteUrl: null, allowed: [] };
const DISCORD_ON = {
  connected: true,
  interactionsUrl: "https://hq-acme.zerops.app/api/intake/discord/acme",
  inviteUrl: "https://discord.com/oauth2/authorize?client_id=1",
  allowed: ["123456789012345678"],
};
// As HQ makes it (`mate-hq apps/hq/src/slack.ts`).
const SLACK_MANIFEST = JSON.stringify({
  display_information: { name: "Mate" },
  features: { bot_user: { display_name: "Mate", always_online: true } },
  oauth_config: { scopes: { bot: ["app_mentions:read", "chat:write", "channels:history"] } },
  settings: {
    event_subscriptions: {
      request_url: "https://hq-acme.zerops.app/api/intake/slack/acme",
      bot_events: ["app_mention", "message.channels", "message.groups"],
    },
    org_deploy_enabled: false,
    socket_mode_enabled: false,
    token_rotation_enabled: false,
  },
});

/**
 * The limits per task and the monthly budget over one record, as HQ answers a save a moment
 * later: a budget above $1,000 or more than 120 minutes is refused, anything else kept.
 */
function LimitsRows() {
  const [held, setHeld] = useState<HqTaskLimitsView>({
    minutes: 60,
    costUsd: 5,
    monthlyBudgetUsd: 50,
    spentThisMonthUsd: 6.44,
    model: "nebius/zai-org/GLM-5.3",
  });
  const [action, setAction] = useState<unknown>({ kind: "idle" });
  const limits = {
    read: { setting: known(held), action, revealed: null } as TaskSourceSettingValue<never>,
    write: (change: { readonly kind: string; readonly limits?: HqTaskLimitsView }) => {
      const next = change.limits!;
      setAction({ kind: "working", verb: "task-limits" });
      setTimeout(() => {
        const refusal =
          (next.monthlyBudgetUsd ?? 0) > 1000
            ? "HQ refused the budget: it is an amount above $0 and at most $1,000 here."
            : next.minutes > 120
              ? "HQ refused the limits: at most 120 minutes here."
              : null;
        if (refusal === null) {
          setHeld((current) => ({ ...current, ...next }));
          setAction({ kind: "done", verb: "task-limits" });
        } else setAction({ kind: "failed", words: refusal });
      }, 900);
    },
    again: nothing,
  };
  return (
    <LimitsList>
      <AutomatedModelView controls={limits} defaultOpen={view === "model"} />
      <TaskLimitsView controls={limits} />
      <MonthlyBudgetView controls={limits} />
    </LimitsList>
  );
}

function Page({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-8 py-10 text-foreground">
      <div className="mx-auto max-w-4xl">{children}</div>
    </div>
  );
}

function Automation({
  github,
  admin,
  open = false,
  checking = false,
}: {
  readonly github: unknown;
  readonly admin: boolean;
  readonly open?: boolean;
  readonly checking?: boolean;
}) {
  const at = (value: unknown) => controls(checking ? { state: "reading" } : known(value));
  const app = (
    <GithubAppView
      admin={admin}
      controls={{
        read: controls(checking ? { state: "reading" } : github)
          .read as TaskSourceSettingValue<"hqGithub">,
        again: nothing,
        manifest: async () => null,
        install: async () => null,
        forget: nothing,
        confirm: nothing,
        accept: nothing,
        suspend: nothing,
        resume: nothing,
      }}
      applicationOf={(id) => APPLICATIONS[id]}
      defaultCreating={open}
      defaultRemoving={view === "remove" ? PERSONAL.appId : null}
      nameOf={(id) => PEOPLE[id]}
      onOpen={nothing}
      onPost={nothing}
      organization="Acme"
      returnTo="https://acme.example/mate/settings/automation?github=connected"
      returned={view === "requested" ? "requested" : null}
    />
  );
  return (
    <Page>
      <SettingsSection title="Automation">
        {admin ? (
          <>
            <IntegrationList>
              <OrganizationKeyView
                onAgain={nothing}
                onRemove={nothing}
                onSet={nothing}
                provider={NEBIUS}
                read={checking ? { keys: { state: "reading" }, action: { kind: "idle" } } : KEY_SET}
              />
              {app}
              <SlackSettingsView
                channels={controls(
                  known({
                    bot: "mate",
                    channels: [
                      { id: "C0SUPPORT", name: "support" },
                      { id: "C0ORDERS", name: "orders" },
                    ],
                  }),
                )}
                controls={at(
                  open
                    ? { ...SLACK, connected: false, workspace: null }
                    : view === "slack-refused"
                      ? {
                          ...SLACK,
                          eventsRefusedAt: "2026-10-18T22:05:00.000Z",
                          eventsAcceptedAt: "2026-10-18T21:40:00.000Z",
                        }
                      : SLACK,
                )}
                defaultOpen={open || view === "slack-refused"}
                manifest={controls(known(SLACK_MANIFEST))}
              />
              <DiscordSettingsView
                controls={at(view === "manage" ? DISCORD_ON : DISCORD_OFF)}
                defaultOpen={open || view === "manage"}
              />
            </IntegrationList>
            {checking ? (
              <LimitsList>
                <TaskLimitsView controls={at({ minutes: 60, costUsd: 5 })} />
              </LimitsList>
            ) : (
              <LimitsRows />
            )}
          </>
        ) : (
          <IntegrationList>{app}</IntegrationList>
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
const APP = {
  kind: "connected",
  name: "Acme Mate",
  repositories: ["acme/api", "acme/tea-shop", "acme/web"],
  installUrl: ACME.installUrl,
  installTrip: true,
  appId: 123456,
} satisfies GitMirrorApp;
/** HQ's application offers to an Owner or Admin, as its navigation streams them. */
const OFFERS = {
  add_mate: { allow: true },
  structure: { allow: true },
  release: { allow: true },
  add_git_environment: { allow: true },
} as const satisfies HqApplicationOffers;
/** And to a member who is neither. */
const MEMBER_OFFERS = {
  add_mate: { allow: true },
  structure: { allow: false, reason: "not_structure_writer" },
  release: { allow: false, reason: "not_releaser" },
  add_git_environment: { allow: false, reason: "not_structure_writer" },
} as const satisfies HqApplicationOffers;
const ACTIONS = {
  connect: async () => ({ ok: false as const, reason: "Fixture." }),
  replaceToken: async () => ({ ok: false as const, reason: "Fixture." }),
  disconnect: async () => {},
  viaApp: async () => {},
  unfollow: async () => {},
};
const GIT_ENVIRONMENTS = [
  { name: "tea-shop-production", target: { kind: "git" } },
  { name: "tea-shop-stage", target: { kind: "git" } },
];
const repo = (name: string, remote: unknown, follows?: string) =>
  ({
    name,
    mainHead: null,
    updatedAt: null,
    remote,
    ...(follows === undefined ? {} : { follows }),
  }) as never;

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
          admin
          onInstall={nothing}
          onOpenAutomation={nothing}
          repos={[repo("appdev", null)]}
        />
      </DialogFrame>
      <DialogFrame title="App connected, the person's account waits for an OK">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={OFFERS}
          github={{
            ...APP,
            waiting: [{ account: "lukas-dev", repositories: ["lukas-dev/tea-shop"] }],
          }}
          admin
          onInstall={nothing}
          onOpenAutomation={nothing}
          repos={[repo("appdev", null)]}
        />
      </DialogFrame>
      <DialogFrame title="App connected, read by a member">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={MEMBER_OFFERS}
          github={APP}
          repos={[repo("appdev", null)]}
        />
      </DialogFrame>
      <DialogFrame title="No app, read by a member">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={MEMBER_OFFERS}
          github={{ kind: "none" }}
          onOpenAutomation={nothing}
          repos={[repo("appdev", null)]}
        />
      </DialogFrame>
      <DialogFrame title="Followed, Mate keeps the code">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={OFFERS}
          github={APP}
          repos={[repo("appdev", null, REMOTE.url)]}
        />
      </DialogFrame>
      <DialogFrame title="Followed, read by a member">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={MEMBER_OFFERS}
          github={APP}
          repos={[repo("appdev", null, REMOTE.url)]}
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
      <DialogFrame title="Mirrored with a token, Git environments use it">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={OFFERS}
          environments={GIT_ENVIRONMENTS}
          github={APP}
          repos={[repo("appdev", { ...REMOTE, via: "token" })]}
        />
      </DialogFrame>
      <DialogFrame title="Mirrored through the app, Git environments use it">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={OFFERS}
          environments={GIT_ENVIRONMENTS}
          github={APP}
          repos={[repo("appdev", { ...REMOTE, via: "app", governance: "no_ruleset" })]}
        />
      </DialogFrame>
      <DialogFrame title="Main protected">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={OFFERS}
          github={APP}
          repos={[repo("appdev", { ...REMOTE, via: "app", governance: "governed" })]}
        />
      </DialogFrame>
      <DialogFrame title="Main not protected">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={OFFERS}
          github={APP}
          repos={[repo("appdev", { ...REMOTE, via: "app", governance: "no_ruleset" })]}
        />
      </DialogFrame>
      <DialogFrame title="Main not protected — permissions not approved">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={OFFERS}
          github={APP}
          repos={[repo("appdev", { ...REMOTE, via: "app", governance: "permission_not_approved" })]}
        />
      </DialogFrame>
      <DialogFrame title="Diverged">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={OFFERS}
          github={APP}
          repos={[repo("appdev", { ...REMOTE, via: "app", divergedSince: "2026-10-16T12:00:00Z" })]}
        />
      </DialogFrame>
      <DialogFrame title="Token refused">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={OFFERS}
          github={APP}
          repos={[
            repo("appdev", { ...REMOTE, via: "token", invalidSince: "2026-10-15T08:00:00Z" }),
          ]}
        />
      </DialogFrame>
      <DialogFrame title="App gone">
        <GitRemoteSettings
          actions={ACTIONS}
          appId="tea-shop"
          appName="Tea Shop"
          can={OFFERS}
          github={{ kind: "none" }}
          repos={[repo("appdev", { ...REMOTE, via: "app" })]}
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
          admin={!view.endsWith("member")}
          checking={view === "checking"}
          open={view === "open" || view === "add"}
          github={
            view === "none" || view === "open"
              ? known({ apps: [] })
              : view === "failed"
                ? { state: "failed", words: "HQ isn't answering right now." }
                : view === "requested"
                  ? known({ apps: [{ ...ACME, installations: [] }] })
                  : view === "older"
                    ? { state: "unsupported" }
                    : view === "two" ||
                        view === "remove" ||
                        view === "add" ||
                        view === "many-member"
                      ? known(TWO)
                      : view === "unsealed" || view === "unsealed-member"
                        ? known({ apps: [UNSEALED] })
                        : view === "private"
                          ? known({ apps: [{ ...ACME, public: false }] })
                          : known(ONE)
          }
        />
      )}
    </StrictMode>,
  );
}
