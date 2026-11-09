/**
 * Connecting a code repository to GitHub: the project page's Repositories rows in every state
 * (not on GitHub, pushing, in sync, diverged, app removed, app not on the account, token refused,
 * token running out, disconnecting) and the connect dialog in each of its steps.
 *
 * Served by the dev server at `/design-github.html` (`?theme=dark`; `?dialog=` one of `today`,
 * `two-apps`, `back`, `explain`, `explain-two`, `no-app`, `token`, `connecting`, `pushing`,
 * `rules`, `done` opens the dialog in that step). Open it at the owner's 1786 × 1000.
 *
 * Fixtures only. Nothing here ships — `design-github.html` is not `index.html`, and no route
 * imports this module.
 */
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { connectLeadLine } from "~/components/zerops/gitMirror.logic";
import {
  GithubConnectPickerView,
  type GithubConnectPickerViewProps,
} from "~/components/zerops/github/GithubConnectPicker";
import { RepoRowsView } from "~/components/zerops/github/GithubRepoRows";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import type {
  GitMirrorAppEntry,
  GitMirrorApps,
  GitMirrorInstallation,
  GitMirrorRepository,
} from "~/zerops/useGitMirrorApps";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const DIALOG = params.get("dialog");
const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const inDays = (days: number) => new Date(NOW + days * 86_400_000).toISOString();
const nothing = () => {};
const never = () => new Promise<never>(() => {});

const VIEWER = "user-me";
const PEOPLE: Record<string, string> = { "user-dana": "Dana K.", "user-me": "Ales R." };
const PROJECTS: Record<string, string> = { notes: "Notes", shop: "Demo Shop", tea: "Tea Shop" };

const app = (appId: number, name: string, owner: string, extra: Partial<GitMirrorAppEntry>) =>
  ({
    appId,
    name,
    slug: name.toLowerCase().replace(/ /gu, "-"),
    owner,
    ownerType: "Organization",
    botLogin: `${name.toLowerCase().replace(/ /gu, "-")}[bot]`,
    setUpBy: "user-dana",
    setUpAt: ago(60 * 24 * 30),
    public: true,
    installUrl: `https://github.com/apps/${name.toLowerCase().replace(/ /gu, "-")}/installations/new`,
    appUrl: `https://github.com/apps/${name.toLowerCase().replace(/ /gu, "-")}`,
    installTrip: true,
    unanswered: 0,
    ...extra,
  }) satisfies GitMirrorAppEntry;

const ACME_MATE = app(101, "Acme Mate", "acme", {});
const OCTO_MATE = app(202, "Octo Mate", "octo-dev", { ownerType: "User", setUpBy: VIEWER });

const repository = (
  fullName: string,
  usedBy: GitMirrorRepository["usedBy"] = null,
): GitMirrorRepository => ({
  id: fullName.length,
  fullName,
  private: true,
  defaultBranch: "main",
  usedBy,
});

const installation = (
  installationId: number,
  appId: number,
  account: string,
  addedBy: string | null,
  repositories: ReadonlyArray<GitMirrorRepository>,
): GitMirrorInstallation => ({
  installationId,
  appId,
  account,
  accountType: "Organization",
  standing: "accepted",
  addedBy,
  manageUrl: `https://github.com/organizations/${account}/settings/installations/${String(installationId)}`,
  repositories,
});

const OTHERS = [
  installation(1, ACME_MATE.appId, "acme", "user-dana", [
    repository("acme/notes-app", { application: "notes", repo: "appdev" }),
  ]),
  installation(2, ACME_MATE.appId, "studio-x", null, [
    repository("studio-x/docs", { application: "shop", repo: "docsdev" }),
  ]),
];
const MINE = installation(3, OCTO_MATE.appId, "octo-dev", VIEWER, [
  repository("octo-dev/tea-shop"),
  repository("octo-dev/demo-site", { application: "shop", repo: "appdev" }),
  repository("octo-dev/dotfiles"),
]);
// The same account through the older app too: listed once, through the one the viewer set up.
const MINE_TWICE = installation(4, ACME_MATE.appId, "octo-dev", VIEWER, MINE.repositories);

const TODAY: GitMirrorApps = { kind: "ready", apps: [ACME_MATE], installations: OTHERS };
const TWO_APPS: GitMirrorApps = {
  kind: "ready",
  apps: [ACME_MATE, OCTO_MATE],
  installations: [...OTHERS, MINE_TWICE, MINE],
};
const NO_APP: GitMirrorApps = { kind: "ready", apps: [], installations: [] };

const remote = (url: string, extra: Partial<NonNullable<RepoListEntry["remote"]>> = {}) => ({
  url,
  repositoryId: "7",
  keptAt: ago(60 * 24 * 7),
  keptBy: "Ales R.",
  expiresAt: null,
  invalidSince: null,
  ...extra,
});

const entry = (
  name: string,
  rest: Partial<RepoListEntry> = {},
  canDelete = true,
): RepoListEntry => ({
  name,
  mainHead: null,
  updatedAt: ago(30),
  ...(canDelete ? { canDelete: { allow: true } } : {}),
  ...rest,
});

const ROWS: ReadonlyArray<RepoListEntry> = [
  entry("tea-shop"),
  entry("pushing", {
    remote: remote("https://github.com/octo-dev/pushing.git", { via: "app", githubAppId: 202 }),
    mirror: { syncedAt: null, divergedSince: null },
  }),
  entry("appdev", {
    remote: remote("https://github.com/octo-dev/tea-api.git", {
      via: "app",
      githubAppId: 202,
      governance: "governed",
    }),
    mirror: { syncedAt: ago(4), divergedSince: null },
  }),
  entry("docsdev", {
    remote: remote("https://github.com/studio-x/docs.git", {
      via: "app",
      githubAppId: 101,
      divergedSince: "2026-11-03T10:00:00Z",
    }),
    mirror: { syncedAt: ago(60 * 24 * 6), divergedSince: "2026-11-03T10:00:00Z" },
  }),
  entry("demodev", {
    remote: remote("https://github.com/octo-dev/demo-site.git", {
      via: "app",
      githubAppId: null,
      invalidSince: "2026-11-08T10:00:00Z",
    }),
  }),
  entry("webdev", {
    remote: remote("https://github.com/octo-dev/web.git", {
      via: "app",
      githubAppId: 101,
      invalidSince: "2026-11-08T10:00:00Z",
    }),
  }),
  entry("labdev", {
    remote: remote("https://gitlab.com/octo-dev/lab.git", {
      via: "token",
      invalidSince: "2026-11-03T10:00:00Z",
    }),
  }),
  entry("appsdev", {
    remote: remote("https://github.com/octo-dev/apps-test.git", {
      via: "token",
      expiresAt: inDays(11),
    }),
    mirror: { syncedAt: ago(90), divergedSince: null },
  }),
  entry("gone", {
    remote: remote("https://github.com/octo-dev/gone.git", { via: "app", githubAppId: 202 }),
    mirror: { syncedAt: ago(60), divergedSince: null },
  }),
];

const ACTIONS = {
  disconnect: never,
  replaceToken: never,
  unfollow: never,
  deleteRepository: never,
};

function Rows() {
  return (
    <section className="grid w-180 gap-1 rounded-2xl border bg-card p-3" data-harness="rows">
      <h2 className="px-2 text-sm font-medium text-muted-foreground">Repositories</h2>
      <RepoRowsView
        actions={ACTIONS}
        admin
        apps={TWO_APPS.kind === "ready" ? TWO_APPS : null}
        authority={null}
        dependencies={[]}
        now={NOW}
        onConnect={nothing}
        onSetUpGithub={nothing}
        orgName="Acme Org"
        pressOf={(repo) => (repo === "gone" ? "disconnecting" : null)}
        project="tea"
        projectName="Tea Shop"
        repos={ROWS}
      />
    </section>
  );
}

const PICKER: Omit<GithubConnectPickerViewProps, "apps"> = {
  project: "tea",
  projectName: "Tea Shop",
  repo: "tea-shop",
  entry: entry("tea-shop"),
  usedApps: [],
  viewerId: VIEWER,
  admin: true,
  orgName: "Acme Org",
  nameOf: (id) => PEOPLE[id],
  projectNameOf: (id) => PROJECTS[id],
  authority: null,
  fresh: new Set(),
  press: null,
  density: "full",
  actions: {
    connectViaApp: never,
    connectToken: never,
    install: nothing,
    leaving: nothing,
    openSettings: nothing,
    onConnected: nothing,
  },
};

const connected = (synced: string | null, governance?: "no_ruleset"): RepoListEntry =>
  entry("tea-shop", {
    remote: remote("https://github.com/octo-dev/tea-shop.git", {
      via: "app",
      githubAppId: 202,
      ...(governance === undefined ? {} : { governance }),
    }),
    mirror: { syncedAt: synced, divergedSince: null },
  });
const SENT = { repository: "octo-dev/tea-shop", via: { kind: "app", app: OCTO_MATE } } as const;

function pickerFor(dialog: string): GithubConnectPickerViewProps | null {
  switch (dialog) {
    case "today":
      return { ...PICKER, apps: TODAY };
    case "two-apps":
      return { ...PICKER, apps: TWO_APPS };
    case "back":
      return {
        ...PICKER,
        apps: TWO_APPS,
        fresh: new Set(["octo-dev/tea-shop"]),
      };
    case "explain":
      return { ...PICKER, apps: TODAY, initial: { step: "explain" } };
    case "explain-two":
      return { ...PICKER, apps: TWO_APPS, admin: false, initial: { step: "explain" } };
    case "no-app":
      return { ...PICKER, apps: NO_APP, initial: { step: "explain" } };
    case "token":
      return { ...PICKER, apps: TWO_APPS, initial: { step: "token" } };
    case "connecting":
      return { ...PICKER, apps: TWO_APPS, initial: { sent: { ...SENT, answered: false } } };
    case "pushing":
      return {
        ...PICKER,
        apps: TWO_APPS,
        entry: connected(null),
        initial: { sent: { ...SENT, answered: true } },
      };
    case "rules":
      return {
        ...PICKER,
        apps: TWO_APPS,
        entry: connected(ago(0)),
        initial: { sent: { ...SENT, answered: true } },
      };
    case "done":
      return {
        ...PICKER,
        apps: TWO_APPS,
        entry: connected(ago(0), "no_ruleset"),
        initial: { sent: { ...SENT, answered: true } },
      };
    default:
      return null;
  }
}

function Harness() {
  const picker = DIALOG === null ? null : pickerFor(DIALOG);
  return (
    <div className="flex min-h-screen flex-wrap content-start gap-8 bg-background p-8 text-foreground">
      <Rows />
      {picker === null ? null : (
        <Dialog onOpenChange={nothing} open>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Connect tea-shop to GitHub</DialogTitle>
              <DialogDescription>{connectLeadLine("tea-shop")}</DialogDescription>
            </DialogHeader>
            <GithubConnectPickerView {...picker} />
          </DialogPopup>
        </Dialog>
      )}
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
