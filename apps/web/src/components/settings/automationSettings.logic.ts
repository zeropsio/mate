/**
 * What Settings › Automation's GitHub section says, from what HQ answered of the organization's
 * GitHub apps: each app, whose it is, who set it up, where it is installed and what goes through
 * it; an HQ older than the apps, or a person who may not see them — and how a press of *Create
 * GitHub app* hands GitHub HQ's manifest.
 */
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
export const GITHUB_OLDER_HQ = "Update HQ to connect GitHub";
export const GITHUB_WHO_CAN = "The organization's Owner and Admins add GitHub apps.";
const WITHHELD = "Only the organization's Owner and Admins see this.";

/** A Mate code repository connected through an app: HQ's application id, its repository, and GitHub's. */
export interface GithubAppUse {
  readonly application: string;
  readonly repo: string;
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
  /** The accounts it is installed on and not waiting for an OK, in HQ's order. */
  readonly accounts: ReadonlyArray<string>;
  /** The Mate repositories whose remote is a repository this app reaches. */
  readonly uses: ReadonlyArray<GithubAppUse>;
  /** Where it is installed and Mate acts, or GitHub suspended it. */
  readonly installations: ReadonlyArray<{
    readonly id: number;
    readonly line: string;
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
   * person may add, confirm, install further, judge what waits, or remove.
   */
  | { readonly kind: "apps"; readonly apps: ReadonlyArray<GithubAppRow>; readonly manage: boolean };

/**
 * Who vouched for an app. `sealed`: the Owner or Admin who made or confirmed it (a Zerops user id),
 * and when; `needed`: nobody did, so HQ acts with it on nothing until an Owner or Admin confirms it.
 */
export type GithubSeal =
  | { readonly kind: "sealed"; readonly by: string; readonly at: string | null }
  | { readonly kind: "needed" };

export const NEEDS_CONFIRM = "Needs an Owner or Admin to confirm it before Mate uses it.";
export const CONFIRM_WHO_CAN = "Ask one of them to confirm it here.";

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
  by: string | null | undefined,
  at: string | null | undefined,
  nameOf: NameOf,
  day: (iso: string) => string,
): string {
  const name = by === null || by === undefined ? undefined : nameOf(by);
  return `${name === undefined ? "" : ` by ${name}`}${at === null || at === undefined ? "" : ` on ${day(at)}`}`;
}

/** A member's name by Zerops user id; where no member list is read, nobody is named. */
export type NameOf = (userId: string) => string | undefined;
export const NOBODY_NAMED: NameOf = () => undefined;

/**
 * Who connected a Slack app or Discord application and when ("Connected by Ada Lovelace on 7 Nov
 * 2026."); `null` from an older HQ, which says neither.
 */
export function connectedByLine(
  view: { readonly connectedBy?: string | null; readonly connectedAt?: string | null },
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

/** Where the app is installed, in a line: "acme · 3 repositories". */
export function installationLine(
  installation: Pick<HqGithubReadInstallation, "account" | "repositorySelection" | "repositories">,
): string {
  const reach =
    installation.repositorySelection === "all"
      ? "all repositories"
      : installation.repositories.length === 1
        ? "1 repository"
        : `${installation.repositories.length} repositories`;
  return `${installation.account} · ${reach}`;
}

/** The Mate repositories connected to a repository an app reaches, once each. */
export function appUses(app: HqGithubApp): ReadonlyArray<GithubAppUse> {
  const seen = new Map<string, GithubAppUse>();
  for (const installation of app.installations) {
    if (installation.state === "unknown") continue;
    for (const repository of installation.repositories)
      if (repository.usedBy !== null)
        seen.set(`${repository.usedBy.application}/${repository.usedBy.repo}`, {
          ...repository.usedBy,
          fullName: repository.fullName,
        });
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
    accounts: app.installations.flatMap((installation) =>
      installation.state !== "unknown" && installationStanding(installation) !== "waiting"
        ? [installation.account]
        : [],
    ),
    uses: appUses(app),
    installations: app.installations
      .filter((installation) => installationStanding(installation) !== "waiting")
      .map((installation) =>
        installation.state === "unknown"
          ? {
              id: installation.id,
              line: `Installation ${installation.id} · GitHub didn't answer about it`,
              manageUrl: null,
              suspended: false,
            }
          : {
              id: installation.id,
              line:
                installationStanding(installation) === "suspended"
                  ? `${installation.account} · suspended`
                  : installationLine(installation),
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

/** An app's second line: "On acme and nova · 2 repositories connected · pushes as acme-mate[bot]". */
export function appReachLine(app: GithubAppRow): string {
  const on =
    app.accounts.length === 0
      ? "Installed nowhere yet"
      : `On ${app.accounts.length === 1 ? app.accounts[0] : `${app.accounts.slice(0, -1).join(", ")} and ${app.accounts.at(-1)}`}`;
  const used =
    app.uses.length === 1 ? "1 repository connected" : `${app.uses.length} repositories connected`;
  return `${on} · ${used} · pushes as ${app.botLogin}`;
}

/**
 * How GitHub brought the person back here: the app made or installed, an owner's approval asked
 * for, or installed where nobody here started it.
 */
export type GithubReturn = "connected" | "requested" | "waiting" | null;

/** The one line said on the return from GitHub; `null` where there is nothing true to say. */
export function githubReturnLine(returned: GithubReturn, section: GithubSection): string | null {
  const apps = section.kind === "apps" ? section.apps : [];
  if (returned === "requested")
    return "GitHub asked an owner of the GitHub account to approve the app; it's installed once they do.";
  // Said only while an installation waits here: not for another organization, nor after its OK.
  if (returned === "waiting")
    return apps.some((app) => app.waiting.length > 0)
      ? "GitHub installed the app. It waits for an Owner's or Admin's OK before Mate uses it."
      : null;
  // Apps are oldest first: the one just made is the last.
  const newest = apps.at(-1);
  if (returned === "connected" && newest !== undefined)
    return `${newest.name} is set up. Mate acts through it as ${newest.botLogin}.`;
  return null;
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
      return section.words;
    case "apps":
      return section.apps.length === 0
        ? section.manage
          ? "No GitHub app yet"
          : `No GitHub app yet · ${GITHUB_WHO_CAN}`
        : section.apps.length === 1
          ? `1 GitHub app · pushes as ${section.apps[0]!.botLogin}`
          : `${section.apps.length} GitHub apps`;
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
