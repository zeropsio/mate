/**
 * What Settings › Automation's GitHub section says, from what HQ answered of the organization's
 * GitHub apps: each app, whose it is, who set it up, where it is installed and what goes through
 * it; an HQ older than the apps, or a person who may not see them — and how a press of *Create
 * GitHub app* hands GitHub HQ's manifest.
 */
import { couldntRead, hqNeedsUpdate } from "@t3tools/client-runtime/zerops/hq";
import type { SettingValue } from "@t3tools/client-runtime/data";
import type {
  HqGithubApp,
  HqGithubInstallation,
  HqGithubManifestView,
  HqGithubReadInstallation,
  HqGithubView,
} from "@t3tools/shared/hqGithub";

/** GitHub's cap on an app's name. */
export const APP_NAME_MAX = 34;

export const GITHUB_ONE_LINE =
  "Everything Mate writes on GitHub appears as your organization's bot, never a person.";
export const GITHUB_OLDER_HQ = hqNeedsUpdate("connect GitHub");
export const GITHUB_WHO_CAN = "Owners and Admins change this.";
const WITHHELD = "Only the organization's Owner and Admins see this.";

/** A Mate code repository connected through an app: HQ's application id, its repository, and GitHub's. */
export interface GithubAppUse {
  /** `null` (with `repo`) for an application the viewer may not read. */
  readonly application: string | null;
  readonly repo: string | null;
  /** `owner/name` on GitHub. */
  readonly fullName: string;
}

/** One of the organization's apps as its row says it. */
export interface GithubAppRow {
  readonly appId: number;
  /** GitHub's name for it, else its slug. */
  readonly name: string;
  readonly slug: string;
  /** The GitHub account that owns it. */
  readonly owner: string;
  /** Owned by a person's account, which takes the app along when they leave. */
  readonly personal: boolean;
  readonly botLogin: string;
  readonly appUrl: string;
  /** Who vouched for it: {@link GithubSeal}. */
  readonly seal: GithubSeal;
  /** The Mate repositories whose remote is a repository this app reaches. */
  readonly uses: ReadonlyArray<GithubAppUse>;
  /** The GitHub accounts Mate works in through it, or GitHub suspended it on. */
  readonly installations: ReadonlyArray<{
    readonly id: number;
    /** The GitHub account; `null` for one GitHub did not answer about. */
    readonly account: string | null;
    /** An organization's account or a person's own; `null` where GitHub did not answer. */
    readonly accountType: "Organization" | "User" | null;
    /** What Mate may use there and how much of it is connected: {@link accountLine}. */
    readonly line: string;
    /** Zerops user id of who added it from Mate; `null` when added on GitHub, or not answered. */
    readonly addedBy: string | null;
    /** GitHub's page for it; `null` for one GitHub did not answer about. */
    readonly manageUrl: string | null;
    readonly suspended: boolean;
  }>;
  /**
   * Installed where nobody here started it: Mate acts on none of it until an OK. Its page on
   * GitHub is its account's, which the organization's admins cannot open.
   */
  readonly waiting: ReadonlyArray<{
    readonly id: number;
    readonly account: string;
    readonly accountType: "Organization" | "User";
    /** Its repositories, by `owner/name`. */
    readonly repositories: ReadonlyArray<string>;
  }>;
  /**
   * A private app: installable on its owner alone. `settings`: `url` is the GitHub page that
   * makes it public; otherwise the app's own page, its owner's kind unknown.
   */
  readonly privateTo: {
    readonly owner: string;
    readonly url: string;
    readonly settings: boolean;
  } | null;
}

export type GithubSection =
  | { readonly kind: "reading" }
  | { readonly kind: "older" }
  | { readonly kind: "withheld" }
  | { readonly kind: "failed"; readonly words: string }
  /**
   * Every app HQ holds for the organization, oldest first; none yet when empty. `manage`: this
   * person may add, install further, judge what waits, or remove.
   */
  | { readonly kind: "apps"; readonly apps: ReadonlyArray<GithubAppRow>; readonly manage: boolean };

/**
 * Who sealed an app. `sealed`: the Owner or Admin who made it (a Zerops user id), and when;
 * `needed`: nobody is recorded to have, so HQ acts with it on nothing until an Owner or Admin
 * remakes it from the manifest.
 */
export type GithubSeal =
  | { readonly kind: "sealed"; readonly by: string; readonly at: string | null }
  | { readonly kind: "needed" };

export const NEEDS_REMAKE =
  "Nobody is recorded to have set this bot up, so Mate uses it for nothing. An Owner or Admin removes it and adds it again.";

function githubSeal(app: HqGithubApp): GithubSeal {
  return app.sealedBy === null
    ? { kind: "needed" }
    : { kind: "sealed", by: app.sealedBy, at: app.sealedAt };
}

/**
 * Who sealed an organization-wide credential and when, as the tail of a line (" by Ada Lovelace on
 * 7 Nov 2026"): the member list names them, and somebody it does not hold goes unnamed.
 */
export function sealedWords(
  by: string | null,
  at: string | null,
  nameOf: NameOf,
  day: (iso: string) => string,
): string {
  const name = by === null ? undefined : nameOf(by);
  return `${name === undefined ? "" : ` by ${name}`}${at === null ? "" : ` on ${day(at)}`}`;
}

/** A member's name by Zerops user id; where no member list is read, nobody is named. */
export type NameOf = (userId: string) => string | undefined;
export const NOBODY_NAMED: NameOf = () => undefined;

/**
 * Who connected a Slack app or Discord application and when ("Connected by Ada Lovelace on 7 Nov
 * 2026."); `null` where neither is known.
 */
export function connectedByLine(
  view: { readonly connectedBy: string | null; readonly connectedAt: string | null },
  nameOf: NameOf,
  day: (iso: string) => string,
): string | null {
  const tail = sealedWords(view.connectedBy, view.connectedAt, nameOf, day);
  return tail === "" ? null : `Connected${tail}.`;
}

/**
 * Who set an app up, as its row says it: "set up by Dana K., Nov 8", or by an Owner or Admin where
 * the member list does not name them; `null` for an app nobody vouched for.
 */
export function appSetUpWords(
  seal: GithubSeal,
  nameOf: NameOf,
  day: (iso: string) => string,
): string | null {
  if (seal.kind === "needed") return null;
  const name = nameOf(seal.by) ?? "an Owner or Admin";
  return `set up by ${name}${seal.at === null ? "" : `, ${day(seal.at)}`}`;
}

/** Where an installation stands: what HQ says, or `unknown` where GitHub did not answer about it. */
export function installationStanding(
  installation: HqGithubInstallation,
): "accepted" | "waiting" | "suspended" | "unknown" {
  if (installation.state === "unknown") return "unknown";
  if (installation.suspended) return "suspended";
  return installation.state;
}

/**
 * Where a private app is made public: its owner's settings page (an organization's or a person's,
 * as HQ says), or the app's own page where HQ does not say which.
 */
function makePublicAt(app: HqGithubApp) {
  const slug = encodeURIComponent(app.slug);
  if (app.ownerType === "Organization")
    return {
      url: `https://github.com/organizations/${encodeURIComponent(app.owner)}/settings/apps/${slug}/advanced`,
      settings: true,
    };
  if (app.ownerType === "User")
    return { url: `https://github.com/settings/apps/${slug}/advanced`, settings: true };
  return { url: `https://github.com/apps/${slug}`, settings: false };
}

/**
 * An account's line: the repositories Mate may use there, and how many of Mate's code
 * repositories are connected to one of them through this app — "3 repositories Mate may use · 1
 * connected". The two counts are different things, so each says what it counts.
 */
export function accountLine(
  installation: Pick<HqGithubReadInstallation, "repositorySelection" | "repositories">,
  githubAppId: number,
): string {
  const reach =
    installation.repositorySelection === "all"
      ? "All its repositories"
      : installation.repositories.length === 1
        ? "1 repository Mate may use"
        : `${installation.repositories.length} repositories Mate may use`;
  const connected = installation.repositories.filter(
    (repository) => repository.usedBy !== null && repository.usedBy.githubAppId === githubAppId,
  ).length;
  return `${reach} · ${connected === 0 ? "none connected yet" : `${connected} connected`}`;
}

/**
 * The Mate repositories whose remote goes through this app, once each: what stops when it is
 * removed. One connected through another app or a token is not its.
 */
export function appUses(app: HqGithubApp): ReadonlyArray<GithubAppUse> {
  const seen = new Map<string, GithubAppUse>();
  for (const installation of app.installations) {
    if (installation.state === "unknown") continue;
    for (const repository of installation.repositories)
      if (repository.usedBy !== null && repository.usedBy.githubAppId === app.appId)
        seen.set(
          `${repository.usedBy.application ?? ""}/${repository.usedBy.repo ?? repository.fullName}`,
          {
            application: repository.usedBy.application,
            repo: repository.usedBy.repo,
            fullName: repository.fullName,
          },
        );
  }
  return [...seen.values()];
}

/** One app's row, from HQ's answer. */
export function githubAppRow(app: HqGithubApp): GithubAppRow {
  return {
    appId: app.appId,
    name: appName(app),
    slug: app.slug,
    owner: app.owner,
    personal: app.ownerType === "User",
    botLogin: app.botLogin,
    appUrl: app.appUrl,
    seal: githubSeal(app),
    uses: appUses(app),
    installations: app.installations
      .filter((installation) => installationStanding(installation) !== "waiting")
      .map((installation) =>
        installation.state === "unknown"
          ? {
              id: installation.id,
              account: null,
              accountType: null,
              line: "GitHub didn't answer about it",
              addedBy: null,
              manageUrl: null,
              suspended: false,
            }
          : {
              id: installation.id,
              account: installation.account,
              accountType: installation.accountType,
              line:
                installationStanding(installation) === "suspended"
                  ? "Suspended on GitHub"
                  : accountLine(installation, app.appId),
              addedBy: installation.addedBy,
              manageUrl: installation.manageUrl,
              suspended: installationStanding(installation) === "suspended",
            },
      ),
    waiting: app.installations.flatMap((installation) =>
      installation.state !== "unknown" && installationStanding(installation) === "waiting"
        ? [
            {
              id: installation.id,
              account: installation.account,
              accountType: installation.accountType,
              repositories: installation.repositories.map((repository) => repository.fullName),
            },
          ]
        : [],
    ),
    privateTo: app.public === false ? { owner: app.owner, ...makePublicAt(app) } : null,
  };
}

/** The section's state, from HQ's answer and whether the person is the organization's Owner or an Admin. */
export function githubSection(setting: SettingValue<HqGithubView>, admin: boolean): GithubSection {
  switch (setting.state) {
    case "unsupported":
      return { kind: "older" };
    case "withheld":
      return { kind: "withheld" };
    case "failed":
      return { kind: "failed", words: setting.words };
    case "unread":
    case "reading":
      return { kind: "reading" };
    case "known":
      return { kind: "apps", apps: setting.held.apps.map(githubAppRow), manage: admin };
  }
}

/**
 * The bot an *Add a GitHub account* press installs, decided for the person: the one they set up
 * themselves, else the oldest that belongs to a GitHub organization. Never a bot on another
 * person's own account, and never one nobody set up: `null` then, and the press makes the
 * organization's bot first.
 */
export function addingApp(
  apps: ReadonlyArray<GithubAppRow>,
  viewerId: string | null,
): GithubAppRow | null {
  const sealed = apps.filter((app) => app.seal.kind === "sealed");
  return (
    sealed.find(
      (app) => viewerId !== null && app.seal.kind === "sealed" && app.seal.by === viewerId,
    ) ??
    sealed.find((app) => !app.personal) ??
    null
  );
}

/**
 * How GitHub brought the person back here: the app made or installed, an owner's approval asked
 * for, or installed where nobody here started it.
 */
export type GithubReturn = "connected" | "requested" | "waiting" | null;

/**
 * The one line said on the return from GitHub; `null` where there is nothing true to say.
 * `githubAppId`: the app whose install trip brought the person back (`?github-app=`); absent after
 * making one, which is then the newest.
 */
export function githubReturnLine(
  returned: GithubReturn,
  section: GithubSection,
  githubAppId: number | null = null,
): string | null {
  const apps = section.kind === "apps" ? section.apps : [];
  if (returned === "requested")
    return "GitHub asked an owner of that account to approve Mate. It's added once they do.";
  // Said only while an installation waits here: not for another organization, nor after its OK.
  if (returned === "waiting")
    return apps.some((app) => app.waiting.length > 0)
      ? "The account is added on GitHub. It waits for an Owner's or Admin's OK before Mate uses it."
      : null;
  if (returned !== "connected") return null;
  if (githubAppId !== null) {
    const installed = apps.find((app) => app.appId === githubAppId);
    return installed === undefined
      ? null
      : `The account is added. Mate works there as ${installed.botLogin}.`;
  }
  // Apps are oldest first: the one just made is the last.
  const newest = apps.at(-1);
  return newest === undefined ? null : `Mate is on GitHub as ${newest.botLogin}.`;
}

/** The section's state line. */
export function githubStatus(section: GithubSection): string {
  switch (section.kind) {
    case "reading":
      return "Reading…";
    case "older":
      return GITHUB_OLDER_HQ;
    case "withheld":
      return WITHHELD;
    case "failed":
      return couldntRead("the organization's GitHub accounts", section.words);
    case "apps": {
      if (section.apps.length === 0)
        return section.manage
          ? "Mate isn't on GitHub yet"
          : `Mate isn't on GitHub yet · ${GITHUB_WHO_CAN}`;
      // A bot nobody set up is used for nothing, whatever it is installed on.
      const used = section.apps.filter((app) => app.seal.kind === "sealed");
      if (used.length === 0) return "Mate's bot isn't in use: nobody is recorded to have set it up";
      // What people come for: the accounts Mate works in, counted once each; not one GitHub
      // suspended it on, nor one it did not answer about.
      const accounts = new Set(
        used.flatMap((app) =>
          app.installations.flatMap((one) =>
            one.account === null || one.suspended ? [] : [one.account],
          ),
        ),
      ).size;
      return accounts === 0
        ? "Mate's bot is made · no GitHub account added yet"
        : `Mate works in ${accounts === 1 ? "1 GitHub account" : `${accounts} GitHub accounts`}, as a bot of its own`;
    }
  }
}

/**
 * The app's name as first offered: the organization's ("Acme Mate"), within GitHub's cap — empty
 * where one of the organization's apps already has it.
 */
export function defaultAppName(
  organization: string | null | undefined,
  taken: ReadonlyArray<string> = [],
): string {
  const whole = `${(organization ?? "").trim() || "Zerops"} Mate`;
  const name =
    whole.length <= APP_NAME_MAX ? whole : `${whole.slice(0, APP_NAME_MAX - 5).trimEnd()} Mate`;
  return taken.some((one) => one.toLowerCase() === name.toLowerCase()) ? "" : name;
}

/** What is wrong with a typed app name, said before anything is sent; `null` when it can go. */
export function appNameProblem(name: string): string | null {
  const typed = name.trim();
  if (typed.length === 0) return "Name the app.";
  if (typed.length > APP_NAME_MAX) return `GitHub takes at most ${APP_NAME_MAX} characters.`;
  return null;
}

/** The GitHub organization typed to own the app: `null` for the person's own account. */
export function appOwner(typed: string): string | null {
  const owner = typed
    .trim()
    .replace(/^https?:\/\/github\.com\//iu, "")
    .replace(/^@/u, "")
    .replace(/\/+$/u, "");
  return owner.length === 0 ? null : owner;
}

/** Where GitHub sends the person back once the app is made and installed: this page. */
export function githubReturnTo(origin: string, basePath: string): string {
  return `${origin}${basePath}/settings/automation?github=connected`;
}

/**
 * Where one app's install trip comes back: this page, naming the app (`github-app`). HQ sets
 * `github` to how it went and keeps the rest.
 */
export function githubInstallReturnTo(returnTo: string, githubAppId: number): string {
  return `${returnTo}&github-app=${String(githubAppId)}`;
}

/** The app an install trip named on the way back (`?github-app=`), else `null`. */
export function githubReturnedApp(raw: unknown): number | null {
  const id = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Hands GitHub HQ's manifest the way its "new app" page reads it: a form posted in this tab, its
 * `manifest` field the app's definition. GitHub's page takes over from here.
 */
export function postManifest(
  doc: Document,
  view: Pick<HqGithubManifestView, "postUrl" | "manifest">,
) {
  const form = doc.createElement("form");
  form.method = "POST";
  form.action = view.postUrl;
  form.hidden = true;
  const field = doc.createElement("input");
  field.type = "hidden";
  field.name = "manifest";
  field.value = view.manifest;
  form.append(field);
  doc.body.append(form);
  form.submit();
}

/**
 * The repositories the organization's apps reach, by `owner/name`, as every picker offers them (the
 * mirror dialog, the origin sheet).
 */
export function appRepositories(view: HqGithubView | null): ReadonlyArray<string> {
  if (view === null) return [];
  const names = new Set<string>();
  // Only where Mate acts: never a suspended installation's, nor one still waiting for an OK.
  for (const app of view.apps)
    for (const installation of app.installations)
      if (installation.state !== "unknown" && installationStanding(installation) === "accepted")
        for (const repository of installation.repositories) names.add(repository.fullName);
  return [...names].toSorted((a, b) => a.localeCompare(b));
}

/** How many installations of the organization's apps GitHub did not answer about. */
export function unansweredInstallations(view: HqGithubView | null): number {
  if (view === null) return 0;
  return view.apps.reduce(
    (sum, app) =>
      sum + app.installations.filter((installation) => installation.state === "unknown").length,
    0,
  );
}

/** Whether some app of the organization's, vouched for, has an installation Mate acts on. */
export function githubConnected(view: HqGithubView | null): boolean {
  return (
    view !== null &&
    view.apps.some(
      (app) =>
        app.sealedBy !== null &&
        app.installations.some((installation) => installationStanding(installation) === "accepted"),
    )
  );
}

/**
 * The app GitHub tells Mate through about `repository` (`owner/name`): the one whose accepted
 * installation reaches it, else the only app; `undefined` where neither says.
 */
export function appReaching(
  view: HqGithubView | null,
  repository: string | undefined,
): HqGithubApp | undefined {
  if (view === null) return undefined;
  const wanted = repository?.toLowerCase();
  const reaching =
    wanted === undefined
      ? undefined
      : view.apps.find((app) =>
          app.installations.some(
            (installation) =>
              installation.state !== "unknown" &&
              installationStanding(installation) === "accepted" &&
              installation.repositories.some((one) => one.fullName.toLowerCase() === wanted),
          ),
        );
  return reaching ?? (view.apps.length === 1 ? view.apps[0] : undefined);
}

/** An app's name as every surface says it: GitHub's, else its slug. */
export function appName(app: Pick<HqGithubApp, "name" | "slug">): string {
  return app.name ?? app.slug;
}
